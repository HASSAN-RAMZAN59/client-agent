import * as cheerio from 'cheerio';
import { DiscoverySource, DiscoverySourceType, SourceMetrics } from '../discovery-source.interface.js';
import { BusinessDiscoveryQuery, DiscoveredBusinessInput, SourceStatus } from '../../../types/index.js';
import { normalizeBusinessName, normalizeUrl, normalizePhone } from '../normalizer.js';
import { calculateOfficialWebsiteConfidence } from '../website-verifier.js';
import { safetyControls, SafetyControls } from '../../../config/safety.js';
import { safeSleep } from '../../../utils/sleeper.js';
import { logger } from '../../../utils/logger.js';

export class DuckDuckGoSearchDiscoverySource implements DiscoverySource {
  public readonly name = 'DuckDuckGo_PublicSearch';
  public readonly type: DiscoverySourceType = 'search_engine';
  public enabled: boolean;
  public priority: number = 2;
  public status: SourceStatus = 'AVAILABLE';

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

  private cleanTitleToBusinessName(title: string, niche: string, city: string): string {
    let clean = title.trim();
    clean = clean.replace(/\s*[-–—|:]\s*(home|official site|welcome|reviews|facebook|yelp|instagram|linkedin|mapquest|yellowpages|bbb).*$/i, '');
    clean = clean.replace(new RegExp(`\\s*[-–—|:]\\s*${city}.*$`, 'i'), '');
    clean = clean.replace(new RegExp(`\\s*[-–—|:]\\s*${niche}.*$`, 'i'), '');
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

  private isDirectoryOrAggregator(urlStr: string): boolean {
    const lower = urlStr.toLowerCase();
    const directories = [
      'yelp.com',
      'yellowpages.com',
      'mapquest.com',
      'facebook.com',
      'instagram.com',
      'linkedin.com',
      'tripadvisor.com',
      'bbb.org',
      'angi.com',
      'thumbtack.com',
      'healthgrades.com',
      'zocdoc.com',
      'wikipedia.org',
      'duckduckgo.com',
      'google.com',
    ];
    return directories.some((dir) => lower.includes(dir));
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
      const searchQuery = `"${query.niche}" "${query.city}" official website`;
      this.log.info(`Searching public web for query: "${searchQuery}"`);

      const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
      this.metrics.requestsCount++;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        body: `q=${encodeURIComponent(searchQuery)}&b=`,
        signal: AbortSignal.timeout(12000),
      });

      if (response.status === 429) {
        this.markBlocked('Public Search HTTP 429 Rate Limited', 'RATE_LIMITED');
        this.metrics.failedCount++;
        return [];
      }

      if (response.status === 403) {
        this.markBlocked('Public Search HTTP 403 Forbidden', 'BLOCKED');
        this.metrics.failedCount++;
        return [];
      }

      if (!response.ok) {
        this.log.warn(`Public Search returned HTTP status ${response.status}`);
        this.metrics.failedCount++;
        this.status = 'ERROR';
        return [];
      }

      const html = await response.text();
      // Check for challenge or captcha in html without attempting to bypass
      if (html.toLowerCase().includes('anomaly') || html.toLowerCase().includes('captcha') || html.toLowerCase().includes('bot check')) {
        this.markBlocked('Public Search anti-bot challenge encountered. Skipping source.', 'BLOCKED');
        this.metrics.failedCount++;
        return [];
      }

      const $ = cheerio.load(html);
      const results: DiscoveredBusinessInput[] = [];
      const now = new Date();

      $('.result').each((_, elem) => {
        if (results.length >= limit) return;

        const titleElem = $(elem).find('.result__title a');
        const snippetElem = $(elem).find('.result__snippet');

        const rawTitle = titleElem.text().trim();
        const rawHref = titleElem.attr('href') || '';
        const snippet = snippetElem.text().trim();

        if (!rawTitle || !rawHref) return;

        const targetUrl = this.extractOutboundUrl(rawHref);
        if (!targetUrl || this.isDirectoryOrAggregator(targetUrl)) {
          return;
        }

        const normalizedWebsite = normalizeUrl(targetUrl);
        const businessName = this.cleanTitleToBusinessName(rawTitle, query.niche, query.city);

        if (!businessName || businessName.length < 3) return;

        const phoneMatch = snippet.match(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
        const phone = phoneMatch ? normalizePhone(phoneMatch[0]) : undefined;

        const confidence = normalizedWebsite
          ? calculateOfficialWebsiteConfidence(businessName, normalizedWebsite)
          : 'UNKNOWN';

        results.push({
          name: businessName,
          category: query.niche,
          city: query.city,
          country: query.country || 'USA',
          website: normalizedWebsite,
          phone,
          source: 'public_search',
          sourceUrl: targetUrl,
          websiteSource: normalizedWebsite ? 'public_search' : undefined,
          phoneSource: phone ? 'public_search' : undefined,
          officialWebsiteConfidence: confidence,
          discoveredAt: now,
        });
      });

      this.metrics.successfulCount++;
      this.metrics.itemsDiscovered += results.length;
      this.log.info(`Public Search discovered ${results.length} valid business candidates.`);

      await safeSleep(policy.sourceMinDelayMs);
      return results;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`Public Search request failed: ${msg}`);
      this.metrics.failedCount++;
      this.status = 'ERROR';
      return [];
    } finally {
      this.isExecuting = false;
    }
  }
}
