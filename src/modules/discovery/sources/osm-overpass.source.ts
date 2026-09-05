import { DiscoverySource, DiscoverySourceType, SourceMetrics } from '../discovery-source.interface.js';
import { BusinessDiscoveryQuery, DiscoveredBusinessInput, DiscoveredContactInput, SourceStatus, DiscoverySourceOutcome } from '../../../types/index.js';
import { normalizeBusinessName, normalizeEmail, normalizePhone, normalizeUrl } from '../normalizer.js';
import { calculateOfficialWebsiteConfidence } from '../website-verifier.js';
import { getMarketProfile } from '../../../config/markets.js';
import { safetyControls, SafetyControls } from '../../../config/safety.js';
import { LocationResolver, locationResolver as defaultLocationResolver } from '../location/location-resolver.js';
import { safeSleep } from '../../../utils/sleeper.js';
import { logger } from '../../../utils/logger.js';
import { normalizeNiche } from '../niche-normalizer.js';

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

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export class OsmOverpassDiscoverySource implements DiscoverySource {
  public readonly name = 'OpenStreetMap_Overpass';
  public readonly type: DiscoverySourceType = 'geodata';
  public enabled: boolean;
  public priority: number = 1;
  public status: SourceStatus = 'AVAILABLE';
  private outcome: DiscoverySourceOutcome = 'SUCCESS_EMPTY';

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
  private locationResolver: LocationResolver;

  constructor(
    customPolicy?: ReturnType<typeof safetyControls.getPolicy>,
    customLocationResolver?: LocationResolver
  ) {
    const policy = customPolicy || SafetyControls.getInstance().getPolicy();
    this.enabled = policy.discoveryOsmEnabled;
    this.locationResolver = customLocationResolver || defaultLocationResolver;
    if (!this.enabled) {
      this.status = 'DISABLED';
      this.outcome = 'DISABLED';
    }
  }

  public isAvailable(): boolean {
    return this.enabled && this.status === 'AVAILABLE';
  }

  public getOutcome(): DiscoverySourceOutcome {
    return this.outcome;
  }

  public markBlocked(reason: string, status: 'BLOCKED' | 'RATE_LIMITED' | 'ERROR' = 'BLOCKED'): void {
    this.status = status;
    this.outcome = status === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'BLOCKED';
    this.metrics.blockedCount++;
    this.log.warn(`Source ${this.name} deactivated for current run: ${reason} (Status: ${status})`);
  }

  public resetStatus(): void {
    this.status = this.enabled ? 'AVAILABLE' : 'DISABLED';
    this.outcome = this.enabled ? 'SUCCESS_EMPTY' : 'DISABLED';
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
    this.outcome = this.enabled ? 'SUCCESS_EMPTY' : 'DISABLED';
  }

  private mapNicheToOsmTags(niche: string, country?: string): string[] {
    const nicheDef = normalizeNiche(niche);
    const market = getMarketProfile(country);
    const marketKey = nicheDef.canonical.toLowerCase().replace(/_/g, '');

    // 1. Check market-specific mappings using canonical key
    if (market.nicheMappings[marketKey]) {
      return market.nicheMappings[marketKey];
    }

    // 2. Check market mappings against primary term and aliases
    for (const [key, tags] of Object.entries(market.nicheMappings)) {
      if (
        nicheDef.primaryQueryTerm.includes(key) ||
        key.includes(nicheDef.primaryQueryTerm) ||
        nicheDef.aliases.some((a) => a.includes(key) || key.includes(a))
      ) {
        return tags;
      }
    }

    // 3. Fallback to canonical niche's predefined OSM tags
    if (nicheDef.osmTags && nicheDef.osmTags.length > 0 && nicheDef.canonical !== 'UNKNOWN') {
      return nicheDef.osmTags;
    }

    const clean = nicheDef.primaryQueryTerm.replace(/[^a-z0-9]/g, '');
    return clean
      ? [`["amenity"="${clean}"]`, `["office"="${clean}"]`, `["craft"="${clean}"]`, `["shop"="${clean}"]`]
      : ['["amenity"]'];
  }

  public async discover(query: BusinessDiscoveryQuery): Promise<DiscoveredBusinessInput[]> {
    if (!this.enabled) {
      this.outcome = 'DISABLED';
      return [];
    }

    if (!this.isAvailable()) {
      this.log.debug(`Source ${this.name} is currently ${this.status}. Skipping.`);
      this.outcome = 'SKIPPED';
      return [];
    }

    const policy = safetyControls.getPolicy();
    const sourceBudget = policy.sourceMaxRequestsPerRun;

    if (this.metrics.requestsCount >= sourceBudget) {
      this.log.warn(`Source ${this.name} reached SOURCE_MAX_REQUESTS_PER_RUN budget (${sourceBudget}). Skipping further requests.`);
      this.outcome = 'SKIPPED';
      return [];
    }

    // Enforce sequential execution
    while (this.isExecuting) {
      await safeSleep(100);
    }
    this.isExecuting = true;

    try {
      const limit = query.limit || 10;
      const market = getMarketProfile(query.country);

      // 1. Dynamic Generic Location Resolution (4-tier hierarchy)
      const resolvedLocation = await this.locationResolver.resolveLocation({
        city: query.city,
        stateOrProvince: query.state,
        country: query.country,
      });

      if (resolvedLocation.status === 'RATE_LIMITED') {
        this.markBlocked('Overpass API rate limit (429)', 'RATE_LIMITED');
        this.metrics.failedCount++;
        return [];
      }

      if (resolvedLocation.status === 'BLOCKED') {
        this.markBlocked('Overpass API forbidden (403)', 'BLOCKED');
        this.metrics.failedCount++;
        return [];
      }

      if (resolvedLocation.status === 'LOCATION_RESOLUTION_FAILED') {
        this.log.warn(`Location resolution failed for city="${query.city}", country="${query.country || 'N/A'}"`);
        this.outcome = 'LOCATION_RESOLUTION_FAILED';
        this.metrics.failedCount++;
        return [];
      }

      if (resolvedLocation.status === 'LOCATION_AMBIGUOUS') {
        this.log.warn(`Location ambiguous for city="${query.city}". Multiple matches across distinct states/countries.`);
        this.outcome = 'LOCATION_AMBIGUOUS';
        this.metrics.failedCount++;
        return [];
      }

      // 2. Build Overpass query based on resolved geometry (Administrative Area vs Center Radius)
      const tagFilters = this.mapNicheToOsmTags(query.niche, query.country);
      let overpassQuery: string;

      if (resolvedLocation.resolutionType === 'ADMINISTRATIVE_AREA' && resolvedLocation.areaName) {
        const filterUnion = tagFilters
          .map((tag) => `node${tag}(area.searchArea);\n  way${tag}(area.searchArea);\n  relation${tag}(area.searchArea);`)
          .join('\n  ');

        overpassQuery = `
[out:json][timeout:15];
area["name"="${resolvedLocation.areaName}"]->.searchArea;
(
  ${filterUnion}
);
out center ${limit * 3};
`.trim();
      } else if (resolvedLocation.resolutionType === 'CENTER_RADIUS' && resolvedLocation.center) {
        const { lat, lon } = resolvedLocation.center;
        const radiusMeters = resolvedLocation.radiusMeters;
        const filterUnion = tagFilters
          .map((tag) => `node${tag}(around:${radiusMeters},${lat},${lon});\n  way${tag}(around:${radiusMeters},${lat},${lon});\n  relation${tag}(around:${radiusMeters},${lat},${lon});`)
          .join('\n  ');

        overpassQuery = `
[out:json][timeout:15];
(
  ${filterUnion}
);
out center ${limit * 3};
`.trim();
      } else {
        this.outcome = 'LOCATION_RESOLUTION_FAILED';
        return [];
      }

      const nicheDef = normalizeNiche(query.niche);
      this.log.info(`Querying OpenStreetMap Overpass for niche="${nicheDef.label}", resolved="${resolvedLocation.city}" (${resolvedLocation.resolutionType}, ${market.countryCode})`);

      let rawData: OverpassResponse | null = null;
      let lastError: Error | null = null;
      let lastStatus = 200;

      // Try Overpass endpoints with fallback
      for (const endpoint of OVERPASS_ENDPOINTS) {
        if (this.metrics.requestsCount >= sourceBudget) break;

        try {
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

          lastStatus = response.status;

          if (response.status === 429) {
            this.log.warn(`Overpass endpoint ${endpoint} rate limited (429). Trying fallback endpoint if available.`);
            continue;
          }

          if (response.status === 403) {
            this.log.warn(`Overpass endpoint ${endpoint} forbidden (403). Trying fallback endpoint.`);
            continue;
          }

          if (!response.ok) {
            this.log.warn(`Overpass endpoint ${endpoint} returned status ${response.status}`);
            continue;
          }

          rawData = (await response.json()) as OverpassResponse;
          if (rawData && Array.isArray(rawData.elements)) {
            break;
          }
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));
          this.log.warn(`Overpass endpoint ${endpoint} failed: ${lastError.message}`);
        }
      }

      if (!rawData || !rawData.elements || !Array.isArray(rawData.elements)) {
        if (lastStatus === 429) {
          this.markBlocked('Overpass API rate limit (429)', 'RATE_LIMITED');
          this.outcome = 'RATE_LIMITED';
          this.metrics.failedCount++;
        } else if (lastStatus === 403) {
          this.markBlocked('Overpass API forbidden (403)', 'BLOCKED');
          this.outcome = 'BLOCKED';
          this.metrics.failedCount++;
        } else if (lastError) {
          this.metrics.failedCount++;
          const isTimeout = lastError.message.toLowerCase().includes('timeout') || lastError.message.toLowerCase().includes('abort');
          this.outcome = isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR';
          this.log.warn(`All OpenStreetMap Overpass endpoints failed: ${lastError.message}`);
        } else {
          this.metrics.successfulCount++;
          this.outcome = 'SUCCESS_EMPTY';
        }
        return [];
      }

      this.metrics.successfulCount++;
      const results: DiscoveredBusinessInput[] = [];
      const now = new Date();

      for (const el of rawData.elements) {
        if (!el.tags || !el.tags.name) continue;

        const rawName = el.tags.name;
        const normalizedName = normalizeBusinessName(rawName);
        if (!normalizedName || normalizedName.length < 2) continue;

        const osmElementUrl = `https://www.openstreetmap.org/${el.type}/${el.id}`;
        const nativeContacts: DiscoveredContactInput[] = [];

        // 1. Websites & Socials
        const rawWebsite = el.tags.website || el.tags['contact:website'] || el.tags.url;
        const website = normalizeUrl(rawWebsite) || undefined;

        // 2. Extract Phone & Mobile OSM tags with exact provenance
        const phoneTags = [
          { tag: 'contact:phone', val: el.tags['contact:phone'] },
          { tag: 'phone', val: el.tags.phone },
          { tag: 'contact:mobile', val: el.tags['contact:mobile'] },
          { tag: 'mobile', val: el.tags.mobile },
        ];

        let primaryPhone: string | undefined = undefined;
        const seenPhones = new Set<string>();

        for (const pt of phoneTags) {
          if (!pt.val) continue;
          const normalized = normalizePhone(pt.val, market.countryCode);
          if (normalized && !seenPhones.has(normalized)) {
            seenPhones.add(normalized);
            if (!primaryPhone) primaryPhone = normalized;
            nativeContacts.push({
              value: normalized,
              type: 'PHONE',
              classification: 'OSM_PUBLIC_PHONE',
              rawPhone: pt.val,
              normalizedPhone: normalized,
              source: 'osm_overpass',
              sourceUrl: osmElementUrl,
              sourceType: 'OSM_TAG',
              field: pt.tag,
              confidence: 'HIGH',
              qualityScore: 80,
              status: 'VERIFIED_PUBLIC',
              isVerified: true,
              isPublic: true,
            });
          }
        }

        // 3. Extract Email OSM tags with exact provenance
        const emailTags = [
          { tag: 'contact:email', val: el.tags['contact:email'] },
          { tag: 'email', val: el.tags.email },
        ];

        let hasEmail = false;
        const seenEmails = new Set<string>();

        for (const et of emailTags) {
          if (!et.val) continue;
          const cleanEmail = normalizeEmail(et.val);
          if (cleanEmail && cleanEmail.includes('@') && !seenEmails.has(cleanEmail)) {
            seenEmails.add(cleanEmail);
            hasEmail = true;
            nativeContacts.push({
              value: cleanEmail,
              email: cleanEmail,
              type: 'EMAIL',
              classification: 'OSM_PUBLIC_EMAIL',
              source: 'osm_overpass',
              sourceUrl: osmElementUrl,
              sourceType: 'OSM_TAG',
              field: et.tag,
              confidence: 'HIGH',
              qualityScore: 85,
              status: 'VERIFIED_PUBLIC',
              isVerified: true,
              isPublic: true,
            });
          }
        }

        // 4. Address Components
        const street = el.tags['addr:street'] || '';
        const houseNumber = el.tags['addr:housenumber'] || '';
        const postalCode = el.tags['addr:postcode'] || query.postalCode || undefined;
        const state = el.tags['addr:state'] || el.tags['addr:province'] || query.state || undefined;

        const addressParts = [houseNumber, street].filter(Boolean).join(' ');
        const address = addressParts.length > 0 ? addressParts : undefined;

        const confidence = website
          ? calculateOfficialWebsiteConfidence(normalizedName, website)
          : 'UNKNOWN';

        const contactChannel = website
          ? 'WEBSITE_LEAD'
          : hasEmail
          ? 'EMAIL_LEAD'
          : primaryPhone
          ? 'PHONE_ONLY_LEAD'
          : 'NO_CONTACT_LEAD';

        results.push({
          name: normalizedName,
          rawName: el.tags?.name || normalizedName,
          category: nicheDef.label,
          city: query.city,
          state,
          country: market.countryName,
          postalCode,
          marketCode: market.countryCode,
          address,
          phone: primaryPhone,
          phoneClassification: primaryPhone ? 'BUSINESS_PHONE' : undefined,
          website,
          source: 'osm_overpass',
          sources: ['osm_overpass'],
          osmId: `${el.type}/${el.id}`,
          sourceUrl: osmElementUrl,
          queryVariant: `${nicheDef.primaryQueryTerm} in ${query.city}`,
          contactChannel,
          websiteSource: website ? 'osm_overpass' : undefined,
          phoneSource: primaryPhone ? 'osm_overpass' : undefined,
          addressSource: address ? 'osm_overpass' : undefined,
          officialWebsiteConfidence: confidence,
          nameConfidence: 'HIGH',
          discoveredAt: now,
          nativeContacts,
        });

        if (results.length >= limit) break;
      }

      this.metrics.itemsDiscovered += results.length;
      this.outcome = results.length > 0 ? 'SUCCESS_WITH_RESULTS' : 'SUCCESS_EMPTY';
      this.log.info(`OpenStreetMap Overpass discovered ${results.length} valid businesses (Outcome: ${this.outcome}).`);

      await safeSleep(policy.sourceMinDelayMs);
      return results;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`OpenStreetMap Overpass request failed: ${msg}`);
      this.metrics.failedCount++;
      this.status = 'ERROR';
      this.outcome = 'QUERY_ERROR';
      return [];
    } finally {
      this.isExecuting = false;
    }
  }
}
