import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { DiscoverySourceType, SourceMetrics } from '../discovery-source.interface.js';
import { SearchDiscoverySource, SearchProviderReport } from '../search-source.interface.js';
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

export class BrowserSearchDiscoverySource implements SearchDiscoverySource {
  public readonly name = 'Playwright_BrowserSearch';
  public readonly provider = 'BROWSER_SEARCH' as const;
  public readonly type: DiscoverySourceType = 'search_engine';
  public enabled: boolean;
  public priority: number = 3;
  public status: SourceStatus = 'AVAILABLE';
  private outcome: DiscoverySourceOutcome = 'SUCCESS_EMPTY';

  private metrics: SourceMetrics = {
    requestsCount: 0,
    successfulCount: 0,
    failedCount: 0,
    blockedCount: 0,
    itemsDiscovered: 0,
  };

  private queriesAttempted = 0;
  private rawResultsCount = 0;
  private acceptedCandidatesCount = 0;
  private errorCode?: string;

  private isExecuting: boolean = false;
  private log = logger.child('BrowserSearchSource');

  constructor(customPolicy?: ReturnType<typeof safetyControls.getPolicy>) {
    const policy = customPolicy || SafetyControls.getInstance().getPolicy();
    // Enabled by default alongside other discovery sources unless explicitly deactivated
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
    this.errorCode = status;
    this.log.warn(`Source ${this.name} deactivated for current run: ${reason} (Status: ${status})`);
  }

  public getProviderReport(): SearchProviderReport {
    return {
      provider: 'BROWSER_SEARCH',
      status: this.status,
      queriesAttempted: this.queriesAttempted,
      rawResults: this.rawResultsCount,
      acceptedCandidates: this.acceptedCandidatesCount,
      blocked: this.status === 'BLOCKED' || this.outcome === 'BLOCKED',
      errorCode: this.errorCode,
    };
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
    this.queriesAttempted = 0;
    this.rawResultsCount = 0;
    this.acceptedCandidatesCount = 0;
    this.errorCode = undefined;
    this.outcome = this.enabled ? 'SUCCESS_EMPTY' : 'DISABLED';
  }

  private extractOutboundUrl(rawHref: string): string | undefined {
    if (!rawHref) return undefined;
    if (rawHref.includes('uddg=')) {
      try {
        const parsed = new URL(`https://html.duckduckgo.com${rawHref.startsWith('/') ? '' : '/'}${rawHref}`);
        const uddg = parsed.searchParams.get('uddg');
        return uddg ? decodeURIComponent(uddg) : undefined;
      } catch {
        return undefined;
      }
    }
    if (rawHref.startsWith('http://') || rawHref.startsWith('https://')) {
      return rawHref;
    }
    return undefined;
  }

  public async discover(query: BusinessDiscoveryQuery): Promise<DiscoveredBusinessInput[]> {
    if (!this.isAvailable()) {
      this.log.info(`Browser search source is currently ${this.status}. Skipping.`);
      return [];
    }

    if (this.isExecuting) {
      this.log.warn('Browser search source query already in flight. Concurrency limit enforced (1).');
      return [];
    }

    this.isExecuting = true;
    const policy = safetyControls.getPolicy();
    const market = getMarketProfile(query.country);
    const nicheDef = normalizeNiche(query.niche);
    const limit = query.limit || policy.maxResultsPerQuery;

    const queries = generateDiscoveryQueries({
      niche: nicheDef.label,
      city: query.city,
      state: query.state,
      country: query.country || market.countryName,
      maxQueries: query.maxQueries || policy.maxDiscoveryQueriesPerRun,
    });

    const discoveredResults: DiscoveredBusinessInput[] = [];
    const seenDomains = new Set<string>();
    const seenNames = new Set<string>();

    let browser: Browser | null = null;

    try {
      this.log.info(`Launching Playwright standard browser for search fallback: ${query.city} (${nicheDef.label})`);

      browser = await chromium.launch({
        headless: policy.auditHeadless,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      const context: BrowserContext = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });

      const page: Page = await context.newPage();
      page.setDefaultNavigationTimeout(policy.auditPageTimeoutMs);
      page.setDefaultTimeout(policy.auditPageTimeoutMs);

      for (const queryItem of queries) {
        if (discoveredResults.length >= limit) break;
        if (this.metrics.requestsCount >= policy.sourceMaxRequestsPerRun) {
          this.log.warn(`Source per-run request limit (${policy.sourceMaxRequestsPerRun}) reached. Stopping.`);
          break;
        }

        this.metrics.requestsCount++;
        this.queriesAttempted++;
        this.log.info(`[Browser Search] Executing query: ${queryItem.query}`);

        try {
          const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(queryItem.query)}`;
          const response = await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: policy.auditPageTimeoutMs });

          if (!response || response.status() === 429 || response.status() === 403) {
            this.markBlocked(`Public Search returned HTTP ${response?.status() || 'null'}. Stopping provider.`, 'BLOCKED');
            this.metrics.failedCount++;
            break;
          }

          // Strict ordinary browser check: detect anti-bot/CAPTCHA without attempting bypass
          const pageTitle = (await page.title()).toLowerCase();
          const pageHtml = (await page.content()).toLowerCase();

          if (
            pageTitle.includes('captcha') ||
            pageTitle.includes('challenge') ||
            pageTitle.includes('blocked') ||
            pageHtml.includes('anomaly') ||
            pageHtml.includes('challenge-form') ||
            (pageHtml.includes('cloudflare') && pageHtml.includes('ray id')) ||
            pageHtml.includes('please verify you are human')
          ) {
            this.markBlocked('Anti-bot challenge or CAPTCHA encountered in browser search. Halting provider.', 'BLOCKED');
            this.metrics.failedCount++;
            break;
          }

          this.metrics.successfulCount++;

          // Extract search result cards
          const rawItems = await page.$$eval('.result', (elements) => {
            return elements.map((el) => {
              const titleA = el.querySelector('.result__title a');
              const snippetEl = el.querySelector('.result__snippet');
              return {
                title: titleA?.textContent?.trim() || '',
                href: titleA?.getAttribute('href') || '',
                snippet: snippetEl?.textContent?.trim() || '',
              };
            });
          });

          const now = new Date();

          for (const item of rawItems) {
            if (discoveredResults.length >= limit) break;
            if (!item.title || !item.href) continue;

            this.rawResultsCount++;
            const targetUrl = this.extractOutboundUrl(item.href);
            if (!targetUrl || isExcludedDirectoryDomain(targetUrl, query.excludedDomains)) {
              continue;
            }

            const initialClassification = classifyWebsite(targetUrl, undefined, query.city);
            if (initialClassification.type !== 'OFFICIAL_BUSINESS_SITE') {
              continue;
            }

            const normalizedWebsite = normalizeUrl(targetUrl);
            const titleCleanResult = cleanSearchTitleToBusinessName(item.title, {
              city: query.city,
              state: query.state,
              niche: nicheDef.label,
            });

            const candidateName = normalizeBusinessName(titleCleanResult.cleanedName);
            if (!candidateName || candidateName.length < 3) continue;

            const identityCheck = validateBusinessIdentity(candidateName, {
              niche: nicheDef.label,
              city: query.city,
              country: market.countryName,
            });
            if (identityCheck.isUnsafe) {
              continue;
            }

            let domain = '';
            try {
              domain = new URL(normalizedWebsite || targetUrl).hostname.replace(/^www\./i, '');
            } catch {
              continue;
            }

            if (seenDomains.has(domain) || seenNames.has(candidateName.toLowerCase())) {
              continue;
            }

            seenDomains.add(domain);
            seenNames.add(candidateName.toLowerCase());

            const confidence = normalizedWebsite
              ? calculateOfficialWebsiteConfidence(candidateName, normalizedWebsite)
              : 'UNKNOWN';

            discoveredResults.push({
              name: candidateName,
              rawName: item.title,
              category: nicheDef.label,
              city: query.city,
              state: query.state,
              country: market.countryName,
              marketCode: market.countryCode,
              website: normalizedWebsite || targetUrl,
              phone: undefined,
              phoneClassification: undefined,
              source: 'browser_search',
              sources: ['browser_search'],
              sourceUrl: normalizedWebsite || targetUrl,
              queryVariant: queryItem.query,
              contactChannel: 'WEBSITE_LEAD',
              websiteSource: 'browser_search',
              officialWebsiteConfidence: confidence,
              nameConfidence: titleCleanResult.confidence,
              discoveredAt: now,
            });

            this.acceptedCandidatesCount++;
          }

          await safeSleep(Math.max(1000, policy.discoveryRequestDelayMs));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log.warn(`Browser search query failed: "${queryItem.query}": ${msg}`);
          this.metrics.failedCount++;
          break;
        }
      }
    } catch (launchErr: unknown) {
      const msg = launchErr instanceof Error ? launchErr.message : String(launchErr);
      this.log.warn(`Failed to launch browser for search discovery: ${msg}`);
      this.metrics.failedCount++;
      this.markBlocked(`Browser launch failure: ${msg}`, 'ERROR');
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
      this.isExecuting = false;
    }

    this.metrics.itemsDiscovered += discoveredResults.length;
    this.outcome = discoveredResults.length > 0 ? 'SUCCESS_WITH_RESULTS' : 'SUCCESS_EMPTY';
    this.log.info(`Browser search source finished. Discovered ${discoveredResults.length} businesses (Outcome: ${this.outcome}).`);
    return discoveredResults;
  }
}
