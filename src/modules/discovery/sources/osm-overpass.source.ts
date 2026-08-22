import { DiscoverySource, DiscoverySourceType, SourceMetrics } from '../discovery-source.interface.js';
import { BusinessDiscoveryQuery, DiscoveredBusinessInput, SourceStatus } from '../../../types/index.js';
import { normalizeBusinessName, normalizePhone, normalizeUrl } from '../normalizer.js';
import { calculateOfficialWebsiteConfidence } from '../website-verifier.js';
import { safetyControls, SafetyControls } from '../../../config/safety.js';
import { safeSleep } from '../../../utils/sleeper.js';
import { logger } from '../../../utils/logger.js';

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

export class OsmOverpassDiscoverySource implements DiscoverySource {
  public readonly name = 'OpenStreetMap_Overpass';
  public readonly type: DiscoverySourceType = 'geodata';
  public enabled: boolean;
  public priority: number = 1;
  public status: SourceStatus = 'AVAILABLE';

  private metrics: SourceMetrics = {
    requestsCount: 0,
    successfulCount: 0,
    failedCount: 0,
    blockedCount: 0,
    itemsDiscovered: 0,
  };

  // Concurrency guard to enforce sequential execution (concurrency = 1)
  private isExecuting: boolean = false;
  private log = logger.child('OsmOverpassSource');

  constructor(customPolicy?: ReturnType<typeof safetyControls.getPolicy>) {
    const policy = customPolicy || SafetyControls.getInstance().getPolicy();
    this.enabled = policy.discoveryOsmEnabled;
    if (!this.enabled) {
      this.status = 'DISABLED';
    }
  }

  public isAvailable(): boolean {
    return this.enabled && this.status === 'AVAILABLE';
  }

  public markBlocked(reason: string, status: 'BLOCKED' | 'RATE_LIMITED' | 'ERROR' = 'BLOCKED'): void {
    this.status = status;
    this.metrics.blockedCount++;
    this.log.warn(`Source ${this.name} deactivated for current run: ${reason} (Status: ${status})`);
  }

  public resetStatus(): void {
    this.status = this.enabled ? 'AVAILABLE' : 'DISABLED';
  }

  public getMetrics(): Readonly<SourceMetrics> {
    return { ...this.metrics };
  }

  public resetMetrics(): void {
    this.metrics = {
      requestsCount: 0,
      successfulCount: 0,
      failedCount: 0,
      blockedCount: 0,
      itemsDiscovered: 0,
    };
  }

  private mapNicheToOsmTags(niche: string): string[] {
    const lower = niche.toLowerCase();
    if (lower.includes('dentist') || lower.includes('dental')) {
      return ['["amenity"="dentist"]', '["healthcare"="dentist"]'];
    }
    if (lower.includes('doctor') || lower.includes('clinic') || lower.includes('medical')) {
      return ['["amenity"="doctors"]', '["amenity"="clinic"]', '["healthcare"="doctor"]'];
    }
    if (lower.includes('restaurant') || lower.includes('food') || lower.includes('bakery') || lower.includes('cafe')) {
      return ['["amenity"="restaurant"]', '["amenity"="cafe"]'];
    }
    if (lower.includes('plumb')) {
      return ['["craft"="plumber"]', '["trade"="plumber"]'];
    }
    if (lower.includes('law') || lower.includes('legal') || lower.includes('attorney')) {
      return ['["office"="lawyer"]', '["office"="legal"]'];
    }
    if (lower.includes('gym') || lower.includes('fitness')) {
      return ['["leisure"="fitness_centre"]'];
    }
    if (lower.includes('hvac') || lower.includes('electric')) {
      return ['["craft"="electrician"]', '["craft"="hvac"]'];
    }
    return [`["amenity"="${lower.replace(/[^a-z]/g, '')}"]`, `["office"="${lower.replace(/[^a-z]/g, '')}"]`];
  }

  public async discover(query: BusinessDiscoveryQuery): Promise<DiscoveredBusinessInput[]> {
    if (!this.isAvailable()) {
      this.log.debug(`Source ${this.name} is currently ${this.status}. Skipping.`);
      return [];
    }

    const policy = safetyControls.getPolicy();
    const sourceBudget = policy.sourceMaxRequestsPerRun;

    if (this.metrics.requestsCount >= sourceBudget) {
      this.log.warn(`Source ${this.name} reached SOURCE_MAX_REQUESTS_PER_RUN budget (${sourceBudget}). Skipping further requests.`);
      return [];
    }

    // Enforce sequential execution
    while (this.isExecuting) {
      await safeSleep(100);
    }
    this.isExecuting = true;

    try {
      const limit = query.limit || 10;
      const tagFilters = this.mapNicheToOsmTags(query.niche);
      const filterUnion = tagFilters
        .map((tag) => `node${tag}(area.searchArea);\n  way${tag}(area.searchArea);`)
        .join('\n  ');

      const overpassQuery = `
[out:json][timeout:15];
area["name"="${query.city}"]["admin_level"~"^[4-8]$"]->.searchArea;
(
  ${filterUnion}
);
out center ${limit * 2};
`.trim();

      this.log.info(`Querying OpenStreetMap Overpass with User-Agent: "${policy.discoveryUserAgent}" for niche="${query.niche}", city="${query.city}"`);

      const endpoint = 'https://overpass-api.de/api/interpreter';
      this.metrics.requestsCount++;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': policy.discoveryUserAgent,
        },
        body: `data=${encodeURIComponent(overpassQuery)}`,
        signal: AbortSignal.timeout(16000),
      });

      if (response.status === 429) {
        this.markBlocked('Overpass API rate limit (429)', 'RATE_LIMITED');
        this.metrics.failedCount++;
        return [];
      }

      if (response.status === 403) {
        this.markBlocked('Overpass API forbidden (403)', 'BLOCKED');
        this.metrics.failedCount++;
        return [];
      }

      if (!response.ok) {
        this.log.warn(`Overpass API returned status ${response.status}`);
        this.metrics.failedCount++;
        this.status = 'ERROR';
        return [];
      }

      const data = (await response.json()) as OverpassResponse;
      if (!data.elements || !Array.isArray(data.elements)) {
        this.metrics.successfulCount++;
        return [];
      }

      this.metrics.successfulCount++;
      const results: DiscoveredBusinessInput[] = [];
      const now = new Date();

      for (const el of data.elements) {
        if (!el.tags || !el.tags.name) continue;

        const rawName = el.tags.name;
        const normalizedName = normalizeBusinessName(rawName);
        if (!normalizedName) continue;

        const rawWebsite = el.tags.website || el.tags['contact:website'] || el.tags.url;
        const website = normalizeUrl(rawWebsite) || undefined;
        const rawPhone = el.tags.phone || el.tags['contact:phone'];
        const phone = normalizePhone(rawPhone) || undefined;

        const street = el.tags['addr:street'] || '';
        const houseNumber = el.tags['addr:housenumber'] || '';
        const address = street || houseNumber ? `${houseNumber} ${street}`.trim() : undefined;

        const confidence = website
          ? calculateOfficialWebsiteConfidence(normalizedName, website)
          : 'UNKNOWN';

        results.push({
          name: normalizedName,
          category: query.niche,
          city: query.city,
          country: query.country || 'USA',
          address,
          phone,
          website,
          source: 'osm_overpass',
          sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
          websiteSource: website ? 'osm_overpass' : undefined,
          phoneSource: phone ? 'osm_overpass' : undefined,
          addressSource: address ? 'osm_overpass' : undefined,
          officialWebsiteConfidence: confidence,
          discoveredAt: now,
        });

        if (results.length >= limit) break;
      }

      this.metrics.itemsDiscovered += results.length;
      this.log.info(`OpenStreetMap Overpass discovered ${results.length} valid businesses.`);

      // Apply polite source delay
      await safeSleep(policy.sourceMinDelayMs);
      return results;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`OpenStreetMap Overpass request failed: ${msg}`);
      this.metrics.failedCount++;
      this.status = 'ERROR';
      return [];
    } finally {
      this.isExecuting = false;
    }
  }
}
