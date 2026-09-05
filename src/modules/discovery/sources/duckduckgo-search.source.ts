import * as cheerio from 'cheerio';
import { DiscoverySource, DiscoverySourceType, SourceMetrics } from '../discovery-source.interface.js';
import { BusinessDiscoveryQuery, DiscoveredBusinessInput, SourceStatus, DiscoverySourceOutcome } from '../../../types/index.js';
import { normalizeBusinessName, normalizeUrl, normalizePhone, cleanSearchTitleToBusinessName } from '../normalizer.js';
import { calculateOfficialWebsiteConfidence } from '../website-verifier.js';
import { isExcludedDirectoryDomain } from '../excluded-domains.js';
import { classifyWebsite } from '../website-classifier.js';
import { validateBusinessIdentity } from '../identity-validator.js';
import { generateDiscoveryQueries } from '../query-generator.js';
import { getMarketProfile } from '../../../config/markets.js';
import { safetyControls, SafetyControls } from '../../../config/safety.js';
import { safeSleep } from '../../../utils/sleeper.js';
import { logger } from '../../../utils/logger.js';
import { normalizeNiche } from '../niche-normalizer.js';

export class DuckDuckGoSearchDiscoverySource implements DiscoverySource {
  public readonly name = 'DuckDuckGo_PublicSearch';
  public readonly type: DiscoverySourceType = 'search_engine';
  public enabled: boolean;
  public priority: number = 2;
  public status: SourceStatus = 'AVAILABLE';
  private outcome: DiscoverySourceOutcome = 'SUCCESS_EMPTY';

  private metrics: SourceMetrics = {
    requestsCount: 0,
    successfulCount: 0,
    failedCount: 0,
    blockedCount: 0,
    itemsDiscovered: 0,
  };

  private isExecuting: boolean = false;
  private log = logger.child('DuckDuckGoSearchSource');

  constructor(customPolicy?: ReturnType<typeof safetyControls.getPolicy>) {
    const policy = customPolicy || SafetyControls.getInstance().getPolicy();
    this.enabled = policy.discoveryDdgEnabled;
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

  private cleanTitleToBusinessName(title: string, niche: string, city: string): string {
    let clean = title.trim();
    // Remove common title suffixes and aggregator labels
    clean = clean.replace(/\s*[-–—|:]\s*(home|official site|welcome|reviews|facebook|yelp|instagram|linkedin|mapquest|yellowpages|bbb|about us|contact us|online booking|get quote).*$/i, '');
    const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clean = clean.replace(new RegExp(`\\s*[-–—|:]\\s*${escapedCity}.*$`, 'i'), '');

    const nicheDef = normalizeNiche(niche);
    const terms = [nicheDef.primaryQueryTerm, ...nicheDef.aliases, nicheDef.label]
      .filter(Boolean)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (terms.length > 0) {
      clean = clean.replace(new RegExp(`\\s*[-–—|:]\\s*(?:${terms.join('|')}).*$`, 'i'), '');
    }

    clean = clean.replace(/\s*\([^)]*\)$/, ''); // remove trailing parentheticals
    return normalizeBusinessName(clean);
  }

  private extractOutboundUrl(rawHref: string): string | undefined {
    if (!rawHref) return undefined;
    if (rawHref.includes('uddg=')) {
      try {
        const parsed = new URL(`https://html.duckduckgo.com${rawHref.startsWith('/') ? '' : '/'}${rawHref}`);
        const target = parsed.searchParams.get('uddg');
        if (target) return decodeURIComponent(target);
      } catch {
        // fallback
      }
    }
    if (rawHref.startsWith('http://') || rawHref.startsWith('https://')) {
      return rawHref;
    }
    return undefined;
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

    while (this.isExecuting) {
      await safeSleep(100);
    }
    this.isExecuting = true;

    try {
      const limit = query.limit || 10;
      const market = getMarketProfile(query.country);
      const nicheDef = normalizeNiche(query.niche);

      // Generate structured query variants using canonical niche
      const queryVariants = generateDiscoveryQueries({
        niche: nicheDef.primaryQueryTerm || query.niche,
        city: query.city,
        country: query.country,
        state: query.state,
        maxQueries: query.maxQueries || policy.maxDiscoveryQueriesPerRun,
      });

      const discoveredResults: DiscoveredBusinessInput[] = [];
      const seenWebsites = new Set<string>();
      const seenNames = new Set<string>();

      for (const variant of queryVariants) {
        if (discoveredResults.length >= limit) break;
        if (this.metrics.requestsCount >= sourceBudget) break;
        if (!this.isAvailable()) break;

        this.log.info(`Searching public web [Variant: ${variant.templateType}]: "${variant.query}"`);
        this.metrics.requestsCount++;

        const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(variant.query)}`;

        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              'Content-Type': 'application/x-www-form-urlencoded',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
            },
            body: `q=${encodeURIComponent(variant.query)}&b=`,
            signal: AbortSignal.timeout(12000),
          });

          if (response.status === 429) {
            this.markBlocked('Public Search HTTP 429 Rate Limited', 'RATE_LIMITED');
            this.metrics.failedCount++;
            break;
          }

          if (response.status === 403) {
            this.markBlocked('Public Search HTTP 403 Forbidden', 'BLOCKED');
            this.metrics.failedCount++;
            break;
          }

          if (!response.ok) {
            this.log.warn(`Public Search returned HTTP status ${response.status}`);
            this.metrics.failedCount++;
            continue;
          }

          const html = await response.text();
          if (
            html.toLowerCase().includes('anomaly') ||
            html.toLowerCase().includes('captcha') ||
            html.toLowerCase().includes('bot check')
          ) {
            this.markBlocked('Public Search anti-bot challenge encountered. Skipping source.', 'BLOCKED');
            this.metrics.failedCount++;
            break;
          }

          const $ = cheerio.load(html);
          const now = new Date();

          $('.result').each((_, elem) => {
            if (discoveredResults.length >= limit) return;

            const titleElem = $(elem).find('.result__title a');
            const snippetElem = $(elem).find('.result__snippet');

            const rawTitle = titleElem.text().trim();
            const rawHref = titleElem.attr('href') || '';
            const snippet = snippetElem.text().trim();

            if (!rawTitle || !rawHref) return;

            const targetUrl = this.extractOutboundUrl(rawHref);
            if (!targetUrl || isExcludedDirectoryDomain(targetUrl, query.excludedDomains)) {
              return;
            }

            // Quick preliminary URL classification
            const initialClassification = classifyWebsite(targetUrl, undefined, query.city);
            if (initialClassification.type !== 'OFFICIAL_BUSINESS_SITE') {
              return;
            }

            const normalizedWebsite = normalizeUrl(targetUrl);
            const titleCleanResult = cleanSearchTitleToBusinessName(rawTitle, {
              city: query.city,
              state: query.state,
              niche: nicheDef.label,
              country: market.countryName,
            });
            const businessName = titleCleanResult.cleanedName;

            if (!businessName || businessName.length < 3) return;

            // Enforce BUSINESS_IDENTITY_UNSAFE gate
            const identityCheck = validateBusinessIdentity(businessName, {
              niche: nicheDef.label,
              city: query.city,
              country: market.countryName,
            });
            if (identityCheck.isUnsafe) {
              this.log.info(`Search candidate "${businessName}" rejected: BUSINESS_IDENTITY_UNSAFE (${identityCheck.reason})`);
              return;
            }

            // Detailed classification with cleaned business name
            const websiteClassification = classifyWebsite(targetUrl, businessName, query.city);
            if (websiteClassification.type !== 'OFFICIAL_BUSINESS_SITE') {
              this.log.info(`Search candidate "${businessName}" rejected: Website is ${websiteClassification.type} (${targetUrl})`);
              return;
            }

            // In-memory dedup within DDG queries
            const nameKey = businessName.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (seenNames.has(nameKey) || (normalizedWebsite && seenWebsites.has(normalizedWebsite))) {
              return;
            }

            seenNames.add(nameKey);
            if (normalizedWebsite) seenWebsites.add(normalizedWebsite);

            // Extract phone pattern using market regex
            const phoneMatch = snippet.match(market.phonePattern);
            const phone = phoneMatch ? normalizePhone(phoneMatch[0]) : undefined;

            discoveredResults.push({
              name: businessName,
              rawName: rawTitle,
              category: nicheDef.label,
              city: query.city,
              state: query.state,
              country: market.countryName,
              marketCode: market.countryCode,
              postalCode: query.postalCode,
              website: normalizedWebsite,
              phone,
              phoneClassification: phone ? 'BUSINESS_PHONE' : undefined,
              source: 'public_search',
              sourceUrl: targetUrl,
              queryVariant: variant.query,
              contactChannel: normalizedWebsite ? 'WEBSITE_LEAD' : (phone ? 'PHONE_ONLY_LEAD' : 'NO_CONTACT_LEAD'),
              websiteSource: normalizedWebsite ? 'public_search' : undefined,
              phoneSource: phone ? 'public_search' : undefined,
              officialWebsiteConfidence: websiteClassification.confidence,
              officialWebsiteStatus: 'VERIFIED',
              websiteType: 'OFFICIAL_BUSINESS_SITE',
              officialWebsiteEvidence: websiteClassification.evidence,
              nameConfidence: titleCleanResult.confidence,
              discoveredAt: now,
            });
          });

          this.metrics.successfulCount++;

          if (discoveredResults.length >= limit || (discoveredResults.length > 0 && !query.maxQueries)) {
            break;
          }

          await safeSleep(policy.discoveryRequestDelayMs || policy.sourceMinDelayMs);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log.warn(`Public search query "${variant.query}" failed: ${msg}`);
          this.metrics.failedCount++;
        }
      }

      this.metrics.itemsDiscovered += discoveredResults.length;
      if (this.status === 'BLOCKED') {
        this.outcome = 'BLOCKED';
      } else if (discoveredResults.length > 0) {
        this.outcome = 'SUCCESS_WITH_RESULTS';
      } else if (this.metrics.failedCount > 0 && this.metrics.successfulCount === 0) {
        this.outcome = 'NETWORK_ERROR';
      } else {
        this.outcome = 'SUCCESS_EMPTY';
      }

      this.log.info(`Public Search discovered total ${discoveredResults.length} valid business candidates (Outcome: ${this.outcome}).`);
      return discoveredResults;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`Public Search process failed: ${msg}`);
      this.metrics.failedCount++;
      this.status = 'ERROR';
      this.outcome = 'QUERY_ERROR';
      return [];
    } finally {
      this.isExecuting = false;
    }
  }
}
