import * as cheerio from 'cheerio';
import { DiscoverySource, DiscoverySourceType, SourceMetrics } from '../discovery-source.interface.js';
import { BusinessDiscoveryQuery, DiscoveredBusinessInput, SourceStatus, DiscoverySourceOutcome } from '../../../types/index.js';
import { normalizeBusinessName, cleanSearchTitleToBusinessName } from '../normalizer.js';
import { validateBusinessIdentity } from '../identity-validator.js';
import { getMarketProfile } from '../../../config/markets.js';
import { safetyControls, SafetyControls } from '../../../config/safety.js';
import { safeSleep } from '../../../utils/sleeper.js';
import { logger } from '../../../utils/logger.js';
import { normalizeNiche } from '../niche-normalizer.js';

export class DirectoryHintDiscoverySource implements DiscoverySource {
  public readonly name = 'Directory_Hints';
  public readonly type: DiscoverySourceType = 'public_directory';
  public enabled: boolean;
  public priority: number = 4;
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
  private log = logger.child('DirectoryHintSource');

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

  public async discover(query: BusinessDiscoveryQuery): Promise<DiscoveredBusinessInput[]> {
    if (!this.isAvailable()) {
      return [];
    }

    if (this.isExecuting) {
      this.log.warn('Directory hint source query already in flight. Concurrency limit enforced (1).');
      return [];
    }

    this.isExecuting = true;
    const policy = safetyControls.getPolicy();
    const market = getMarketProfile(query.country);
    const nicheDef = normalizeNiche(query.niche);
    const limit = query.limit || policy.maxResultsPerQuery;

    // Construct targeted directory hint queries based on target market
    const directorySites = market.countryCode === 'PK'
      ? ['marham.pk', 'oladoc.com', 'ebizpk.com', 'apkamuaalij.com']
      : ['yellowpages.com', 'yelp.com'];

    const hintQueries = [
      `"${nicheDef.primaryQueryTerm}" ${query.city} site:${directorySites[0]}`,
      `"${nicheDef.primaryQueryTerm}" ${query.city} site:${directorySites[1] || directorySites[0]}`,
    ];

    const discoveredResults: DiscoveredBusinessInput[] = [];
    const seenNames = new Set<string>();

    try {
      for (const hintQuery of hintQueries) {
        if (discoveredResults.length >= limit) break;
        if (this.metrics.requestsCount >= policy.sourceMaxRequestsPerRun) break;

        this.metrics.requestsCount++;
        this.log.info(`[Directory Hints] Executing hint query: ${hintQuery}`);

        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(hintQuery)}`;
        const headers = {
          'User-Agent': policy.discoveryUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        };

        const response = await fetch(url, { headers });
        if (!response.ok) {
          if (response.status === 429 || response.status === 403) {
            this.markBlocked(`Directory hints source returned HTTP ${response.status}`, 'BLOCKED');
            break;
          }
          continue;
        }

        const html = await response.text();
        if (html.toLowerCase().includes('anomaly') || html.toLowerCase().includes('captcha')) {
          this.markBlocked('Directory hint query encountered anti-bot challenge', 'BLOCKED');
          break;
        }

        this.metrics.successfulCount++;
        const $ = cheerio.load(html);
        const now = new Date();

        $('.result').each((_, elem) => {
          if (discoveredResults.length >= limit) return;

          const titleElem = $(elem).find('.result__title a');
          const rawTitle = titleElem.text().trim();
          const rawHref = titleElem.attr('href') || '';
          if (!rawTitle) return;

          // Clean title to business candidate name
          const titleClean = cleanSearchTitleToBusinessName(rawTitle, {
            city: query.city,
            state: query.state,
            niche: nicheDef.label,
          });

          const candidateName = normalizeBusinessName(titleClean.cleanedName);
          if (!candidateName || candidateName.length < 3) return;

          // 1. Enforce business identity validation
          const identityCheck = validateBusinessIdentity(candidateName, {
            niche: nicheDef.label,
            city: query.city,
            country: market.countryName,
          });
          if (identityCheck.isUnsafe) {
            return;
          }

          if (seenNames.has(candidateName.toLowerCase())) return;
          seenNames.add(candidateName.toLowerCase());

          // Note: Directory pages are DISCOVERY HINTS ONLY.
          // They NEVER become official websites, nor do their platform emails/phones become business contacts.
          discoveredResults.push({
            name: candidateName,
            rawName: rawTitle,
            category: nicheDef.label,
            city: query.city,
            state: query.state,
            country: market.countryName,
            marketCode: market.countryCode,
            website: undefined, // Strictly nullified - directory is NOT official website
            phone: undefined,   // Strictly nullified - directory phone is NOT business phone
            source: 'directory_hint',
            sources: ['directory_hint'],
            sourceUrl: rawHref || undefined,
            queryVariant: hintQuery,
            contactChannel: 'NO_CONTACT_LEAD',
            officialWebsiteConfidence: 'UNKNOWN',
            officialWebsiteStatus: 'UNVERIFIED',
            nameConfidence: titleClean.confidence,
            discoveredAt: now,
          });
        });

        await safeSleep(policy.sourceMinDelayMs);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`Directory hint discovery error: ${msg}`);
      this.metrics.failedCount++;
      this.status = 'ERROR';
      this.outcome = 'QUERY_ERROR';
    } finally {
      this.isExecuting = false;
    }

    this.metrics.itemsDiscovered += discoveredResults.length;
    this.outcome = discoveredResults.length > 0 ? 'SUCCESS_WITH_RESULTS' : 'SUCCESS_EMPTY';
    this.log.info(`Directory hints source completed. Discovered ${discoveredResults.length} business candidate hints.`);
    return discoveredResults;
  }
}
