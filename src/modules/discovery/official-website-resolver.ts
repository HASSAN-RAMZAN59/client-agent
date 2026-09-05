import * as cheerio from 'cheerio';
import { normalizeUrl, extractCanonicalDomain, normalizeBusinessName } from './normalizer.js';
import { classifyWebsite } from './website-classifier.js';
import { isExcludedDirectoryDomain } from './excluded-domains.js';
import { safetyControls } from '../../config/safety.js';
import { logger } from '../../utils/logger.js';
import { safeSleep } from '../../utils/sleeper.js';

export type WebsiteIdentityStatus =
  | 'OFFICIAL_CONFIRMED'
  | 'OFFICIAL_PROBABLE'
  | 'UNVERIFIED'
  | 'DIRECTORY'
  | 'AGGREGATOR'
  | 'SOCIAL_PROFILE';

export interface WebsiteResolutionResult {
  status: WebsiteIdentityStatus;
  resolvedUrl?: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  evidence: string[];
}

export class OfficialWebsiteResolver {
  private log = logger.child('OfficialWebsiteResolver');

  /**
   * Resolves whether an unverified or no-website business has an authoritative official website.
   */
  public async resolveOfficialWebsite(business: {
    name: string;
    city: string;
    state?: string;
    country?: string;
  }): Promise<WebsiteResolutionResult> {
    const cleanName = normalizeBusinessName(business.name);
    const cleanCity = business.city.trim();
    if (!cleanName || cleanName.length < 3) {
      return {
        status: 'UNVERIFIED',
        confidence: 'UNKNOWN',
        evidence: ['Business name is too short or invalid for resolution'],
      };
    }

    const policy = safetyControls.getPolicy();
    const targetedQueries = [
      `"${cleanName}" ${cleanCity} official website`,
      `"${cleanName}" ${cleanCity} contact`,
    ];

    for (const queryText of targetedQueries) {
      try {
        this.log.info(`Attempting official website resolution query: ${queryText}`);
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(queryText)}`;
        const headers = {
          'User-Agent': policy.discoveryUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        };

        const res = await fetch(url, { headers });
        if (!res.ok) continue;

        const html = await res.text();
        if (html.toLowerCase().includes('anomaly') || html.toLowerCase().includes('captcha')) {
          this.log.warn('Anti-bot challenge during official website resolution. Halting search.');
          break;
        }

        const $ = cheerio.load(html);
        const candidates: Array<{ title: string; href: string; snippet: string }> = [];

        $('.result').each((_, elem) => {
          if (candidates.length >= 5) return;
          const titleElem = $(elem).find('.result__title a');
          const rawTitle = titleElem.text().trim();
          const rawHref = titleElem.attr('href') || '';
          const snippet = $(elem).find('.result__snippet').text().trim();
          if (rawTitle && rawHref) {
            candidates.push({ title: rawTitle, href: rawHref, snippet });
          }
        });

        for (const candidate of candidates) {
          const targetUrl = this.extractOutboundUrl(candidate.href);
          if (!targetUrl) continue;

          // 1. Check directory / aggregator exclusion
          if (isExcludedDirectoryDomain(targetUrl)) {
            continue;
          }

          // 2. Classify website type
          const classification = classifyWebsite(targetUrl, cleanName, cleanCity);
          if (classification.type === 'SOCIAL_PROFILE') {
            continue;
          }
          if (classification.type !== 'OFFICIAL_BUSINESS_SITE') {
            continue;
          }

          // 3. Perform Deep Website Identity Verification
          const verification = await this.verifyWebsiteIdentity(targetUrl, cleanName, cleanCity);
          if (verification.status === 'OFFICIAL_CONFIRMED' || verification.status === 'OFFICIAL_PROBABLE') {
            this.log.info(
              `Resolved official website for "${cleanName}": ${verification.resolvedUrl} (${verification.status}, Confidence: ${verification.confidence})`
            );
            return verification;
          }
        }

        await safeSleep(policy.sourceMinDelayMs);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`Official website resolution error for "${cleanName}": ${msg}`);
      }
    }

    return {
      status: 'UNVERIFIED',
      confidence: 'UNKNOWN',
      evidence: ['No verified official business website found across public search queries'],
    };
  }

  /**
   * Verifies identity tokens between business entity and candidate website.
   */
  public async verifyWebsiteIdentity(
    url: string,
    businessName: string,
    city: string
  ): Promise<WebsiteResolutionResult> {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) {
      return { status: 'UNVERIFIED', confidence: 'LOW', evidence: ['Invalid URL'] };
    }

    const domain = extractCanonicalDomain(normalizedUrl) || '';
    const cleanBiz = normalizeBusinessName(businessName).toLowerCase();
    const bizTokens = cleanBiz.split(/\s+/).filter((t) => t.length >= 3);
    const domainClean = domain.replace(/[^a-z0-9]/g, '');

    const evidence: string[] = [];
    let domainTokenMatches = 0;

    for (const token of bizTokens) {
      if (domainClean.includes(token)) {
        domainTokenMatches++;
      }
    }

    if (domainTokenMatches >= Math.min(2, bizTokens.length) && bizTokens.length > 0) {
      evidence.push(`Domain "${domain}" matches significant business tokens (${domainTokenMatches}/${bizTokens.length})`);
    }

    // Probing website HTML for title & brand name
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(normalizedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html.slice(0, 150000));
        const pageTitle = $('title').text().trim().toLowerCase();
        const bodyText = $('body').text().slice(0, 5000).toLowerCase();

        let titleMatch = false;
        if (bizTokens.some((token) => pageTitle.includes(token))) {
          titleMatch = true;
          evidence.push(`Page title "${pageTitle.slice(0, 60)}" contains business name token`);
        }

        let cityMatch = false;
        if (city && (pageTitle.includes(city.toLowerCase()) || bodyText.includes(city.toLowerCase()))) {
          cityMatch = true;
          evidence.push(`Website content confirms target city "${city}"`);
        }

        if (domainTokenMatches >= 2 && titleMatch) {
          return {
            status: 'OFFICIAL_CONFIRMED',
            resolvedUrl: normalizedUrl,
            confidence: 'HIGH',
            evidence,
          };
        }

        if (domainTokenMatches >= 1 && (titleMatch || cityMatch)) {
          return {
            status: 'OFFICIAL_PROBABLE',
            resolvedUrl: normalizedUrl,
            confidence: 'MEDIUM',
            evidence,
          };
        }
      }
    } catch {
      // If fetching fails, rely on strong domain token match
      if (domainTokenMatches >= Math.max(2, bizTokens.length)) {
        evidence.push('Strong domain token match verified offline');
        return {
          status: 'OFFICIAL_PROBABLE',
          resolvedUrl: normalizedUrl,
          confidence: 'MEDIUM',
          evidence,
        };
      }
    }

    return {
      status: 'UNVERIFIED',
      confidence: 'LOW',
      evidence: ['Insufficient evidence linking candidate domain to business identity'],
    };
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
}
