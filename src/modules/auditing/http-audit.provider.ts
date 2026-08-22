import * as cheerio from 'cheerio';
import {
  ComprehensiveAuditResult,
  AuditFinding,
} from '../../types/index.js';
import { analyzeSecurity } from './analyzers/security.analyzer.js';
import { analyzeMobile } from './analyzers/mobile.analyzer.js';
import { analyzePerformance } from './analyzers/performance.analyzer.js';
import { analyzeSeo } from './analyzers/seo.analyzer.js';
import { analyzeAccessibility } from './analyzers/accessibility.analyzer.js';
import { analyzeUxConversion } from './analyzers/ux-conversion.analyzer.js';
import { analyzeContent } from './analyzers/content.analyzer.js';
import { analyzeMobileAppOpportunity } from './analyzers/mobile-app-opportunity.analyzer.js';
import { computeAuditScoresAndFlags } from './analyzers/scorer.js';
import { normalizeUrl } from '../discovery/normalizer.js';
import { logger } from '../../utils/logger.js';

export interface HttpAuditOptions {
  timeoutMs?: number;
  businessName?: string;
  category?: string;
}

export class HttpAuditProvider {
  private log = logger.child('HttpAuditProvider');

  public async audit(
    url: string,
    options: HttpAuditOptions = {}
  ): Promise<ComprehensiveAuditResult> {
    const timeoutMs = options.timeoutMs || 10000;
    const businessName = options.businessName || '';
    const category = options.category || 'General Service';
    const now = new Date();

    if (!url || url.trim().length === 0) {
      return {
        website: '',
        status: 'NO_WEBSITE',
        confidence: 'HIGH',
        overallScore: 0,
        categories: {
          technical: 0,
          mobile: 0,
          performance: 0,
          seo: 0,
          accessibility: 0,
          ux: 0,
          content: 0,
        },
        opportunityFlags: ['NO_WEBSITE'],
        mobileAppOpportunity: 'LOW',
        mobileAppReasoning: ['Business does not have an active website.'],
        findings: [
          {
            category: 'technical',
            title: 'No Registered Website',
            description: 'Business has no online presence.',
            severity: 'HIGH',
            evidence: 'No URL provided',
          },
        ],
        topProblems: ['No active website found'],
        pageCount: 0,
        mobileResponsive: false,
        sslValid: false,
        hasContactForm: false,
        loadTimeMs: 0,
        issues: ['Business has no registered website.'],
        auditedAt: now,
      };
    }

    const normalizedUrl = normalizeUrl(url) || url;
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(normalizedUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (Antigravity-Audit/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        redirect: 'follow',
        signal: controller.signal,
      });

      clearTimeout(timer);
      const loadTimeMs = Date.now() - startTime;
      const finalUrl = normalizeUrl(response.url) || normalizedUrl;
      const statusCode = response.status;

      if (statusCode === 403 || statusCode === 429 || statusCode === 401) {
        return {
          website: normalizedUrl,
          finalUrl,
          status: 'BLOCKED',
          confidence: 'LOW',
          overallScore: 50,
          categories: {
            technical: 50,
            mobile: 50,
            performance: 50,
            seo: 50,
            accessibility: 50,
            ux: 50,
            content: 50,
          },
          opportunityFlags: [],
          mobileAppOpportunity: 'MEDIUM',
          mobileAppReasoning: ['Automated audit probe was blocked by web application firewall (WAF).'],
          findings: [
            {
              category: 'technical',
              title: 'Automated Audit Blocked by Server (WAF)',
              description: 'The server returned HTTP 403/429 challenge. Website is active but protected by anti-bot firewall.',
              severity: 'INFO',
              evidence: `HTTP status ${statusCode}`,
            },
          ],
          topProblems: ['Audit probe challenged by WAF'],
          pageCount: 1,
          mobileResponsive: true,
          sslValid: finalUrl.startsWith('https://'),
          hasContactForm: false,
          loadTimeMs,
          issues: [`Server returned HTTP ${statusCode} (Protected by WAF)`],
          auditedAt: now,
        };
      }

      if (!response.ok) {
        return {
          website: normalizedUrl,
          finalUrl,
          status: 'ERROR',
          confidence: 'LOW',
          overallScore: 20,
          categories: {
            technical: 20,
            mobile: 20,
            performance: 20,
            seo: 20,
            accessibility: 20,
            ux: 20,
            content: 20,
          },
          opportunityFlags: ['BROKEN_ELEMENTS'],
          mobileAppOpportunity: 'LOW',
          mobileAppReasoning: [`Server returned HTTP error ${statusCode}.`],
          findings: [
            {
              category: 'technical',
              title: 'Server Error Response',
              description: `Website responded with HTTP status ${statusCode}.`,
              severity: 'HIGH',
              evidence: `HTTP ${statusCode} ${response.statusText}`,
            },
          ],
          topProblems: [`HTTP ${statusCode} error response`],
          pageCount: 1,
          mobileResponsive: false,
          sslValid: finalUrl.startsWith('https://'),
          hasContactForm: false,
          loadTimeMs,
          issues: [`HTTP error ${statusCode}`],
          auditedAt: now,
        };
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Extract DOM signals
      const title = $('title').first().text().trim();
      const metaDescription = $('meta[name="description" i]').attr('content')?.trim();
      const viewportMeta = $('meta[name="viewport" i]').attr('content')?.trim();
      const canonicalUrl = $('link[rel="canonical" i]').attr('href')?.trim();
      const robotsMeta = $('meta[name="robots" i]').attr('content')?.toLowerCase() || '';
      const hasRobotsNoindex = robotsMeta.includes('noindex');

      const h1List: string[] = [];
      $('h1').each((_, el) => {
        const text = $(el).text().trim();
        if (text) h1List.push(text);
      });

      const totalImages = $('img').length;
      let imagesWithAlt = 0;
      $('img').each((_, el) => {
        const alt = $(el).attr('alt');
        if (alt !== undefined && alt.trim().length > 0) imagesWithAlt++;
      });

      let unlabeledButtonsCount = 0;
      $('button').each((_, el) => {
        const text = $(el).text().trim();
        const ariaLabel = $(el).attr('aria-label');
        if (!text && !ariaLabel) unlabeledButtonsCount++;
      });

      let emptyLinksCount = 0;
      $('a').each((_, el) => {
        const text = $(el).text().trim();
        const ariaLabel = $(el).attr('aria-label');
        const href = $(el).attr('href');
        if (href && !text && !ariaLabel) emptyLinksCount++;
      });

      let unlabeledInputsCount = 0;
      $('input:not([type="hidden"]):not([type="submit"]):not([type="button"])').each((_, el) => {
        const id = $(el).attr('id');
        const ariaLabel = $(el).attr('aria-label');
        const hasAssociatedLabel = id ? $(`label[for="${id}"]`).length > 0 : false;
        if (!ariaLabel && !hasAssociatedLabel) unlabeledInputsCount++;
      });

      const fullText = $('body').text().replace(/\s+/g, ' ').trim();
      const words = fullText.split(' ').filter((w) => w.length > 0);
      const wordCount = words.length;

      // UX / Conversion detections
      const hasClickablePhone = $('a[href^="tel:"]').length > 0;
      const phoneRegex = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
      const hasVisiblePhoneText = phoneRegex.test(fullText);

      const hasContactForm = $('form').find('input[type="email"], input[name*="email" i], textarea').length > 0;
      const fullTextLower = fullText.toLowerCase();

      const hasBookingCta = fullTextLower.includes('book appointment') || fullTextLower.includes('schedule online') || fullTextLower.includes('book now') || $('a[href*="booking" i], a[href*="appointment" i]').length > 0;
      const hasQuoteCta = fullTextLower.includes('request quote') || fullTextLower.includes('free estimate') || fullTextLower.includes('get a quote');
      const hasContactCta = fullTextLower.includes('contact us') || fullTextLower.includes('get in touch') || $('a[href*="contact" i]').length > 0;
      const hasPhysicalAddress = $('address').length > 0 || /\b\d{1,5}\s+[\w\s.]+(?:street|st|avenue|ave|road|rd|blvd|boulevard|suite|ste|pkwy)\b/i.test(fullText);
      const hasBusinessHours = fullTextLower.includes('monday') || fullTextLower.includes('business hours') || fullTextLower.includes('open:');
      const hasSocialLinks = $('a[href*="facebook.com"], a[href*="instagram.com"], a[href*="linkedin.com"], a[href*="twitter.com"]').length > 0;

      // Placeholder text check
      const placeholderTerms = ['lorem ipsum', 'dolor sit amet', 'sample text', 'placeholder', 'under construction', 'template designed by'];
      const matchedPlaceholders = placeholderTerms.filter((term) => fullTextLower.includes(term));

      // Execute individual analyzers
      const secRes = analyzeSecurity(finalUrl, html);
      const mobRes = analyzeMobile({
        hasViewportMeta: Boolean(viewportMeta),
        viewportContent: viewportMeta,
        hasHorizontalOverflow: false, // Measured in Level 2 Playwright
      });
      const perfRes = analyzePerformance({
        loadTimeMs,
        pageSizeBytes: Buffer.byteLength(html, 'utf8'),
      });
      const seoRes = analyzeSeo({
        title,
        metaDescription,
        h1List,
        canonicalUrl,
        hasRobotsMetaNoindex: hasRobotsNoindex,
        totalImages,
        imagesWithAlt,
      });
      const a11yRes = analyzeAccessibility({
        totalImages,
        imagesWithAlt,
        unlabeledButtonsCount,
        emptyLinksCount,
        unlabeledInputsCount,
      });
      const uxRes = analyzeUxConversion({
        hasClickablePhone,
        hasVisiblePhoneText,
        hasContactForm,
        hasBookingCta,
        hasQuoteCta,
        hasContactCta,
        hasPhysicalAddress,
        hasBusinessHours,
        hasSocialLinks,
      });
      const contentRes = analyzeContent({
        bodyWordCount: wordCount,
        hasPlaceholderText: matchedPlaceholders.length > 0,
        placeholderMatches: matchedPlaceholders,
        hasEmptySections: $('section:empty, div.container:empty').length > 1,
      });
      const appRes = analyzeMobileAppOpportunity({
        category,
        hasBooking: hasBookingCta,
        hasOrderingOrMenu: fullTextLower.includes('order online') || fullTextLower.includes('view menu'),
        hasCustomerPortal: fullTextLower.includes('patient portal') || fullTextLower.includes('client login') || fullTextLower.includes('sign in'),
        hasLoyaltyRewards: fullTextLower.includes('rewards') || fullTextLower.includes('loyalty points'),
        hasRecurringMembership: fullTextLower.includes('membership') || fullTextLower.includes('subscription'),
        hasComplexWorkflow: false,
      });

      const allFindings: AuditFinding[] = [
        ...secRes.findings,
        ...mobRes.findings,
        ...perfRes.findings,
        ...seoRes.findings,
        ...a11yRes.findings,
        ...uxRes.findings,
        ...contentRes.findings,
      ];

      const scoreComp = computeAuditScoresAndFlags({
        technicalScore: secRes.score,
        mobileScore: mobRes.score,
        performanceScore: perfRes.score,
        seoScore: seoRes.score,
        accessibilityScore: a11yRes.score,
        uxScore: uxRes.score,
        contentScore: contentRes.score,
        findings: allFindings,
      });

      return {
        website: normalizedUrl,
        finalUrl,
        status: 'AUDITED',
        confidence: 'HIGH',
        overallScore: scoreComp.overallScore,
        categories: scoreComp.categories,
        opportunityFlags: scoreComp.opportunityFlags,
        mobileAppOpportunity: appRes.level,
        mobileAppReasoning: appRes.reasoning,
        findings: allFindings,
        topProblems: scoreComp.topProblems,
        pageCount: 1,
        mobileResponsive: mobRes.mobileResponsive,
        sslValid: secRes.isHttps,
        hasContactForm: uxRes.hasContactForm,
        loadTimeMs,
        issues: allFindings.map((f) => f.title),
        auditedAt: now,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.toLowerCase().includes('aborted') || msg.toLowerCase().includes('timeout');

      return {
        website: normalizedUrl,
        status: isTimeout ? 'TIMEOUT' : 'ERROR',
        confidence: 'LOW',
        overallScore: 25,
        categories: {
          technical: 25,
          mobile: 25,
          performance: 25,
          seo: 25,
          accessibility: 25,
          ux: 25,
          content: 25,
        },
        opportunityFlags: isTimeout ? ['SLOW_LOADING'] : ['BROKEN_ELEMENTS'],
        mobileAppOpportunity: 'LOW',
        mobileAppReasoning: [`Audit failed: ${msg}`],
        findings: [
          {
            category: 'technical',
            title: isTimeout ? 'Connection Timeout During Audit' : 'Network Connection Error',
            description: isTimeout
              ? 'The server took too long to respond to the audit request.'
              : `HTTP connection error: ${msg}`,
            severity: 'HIGH',
            evidence: msg,
          },
        ],
        topProblems: [isTimeout ? 'Connection timeout' : 'Network connection failure'],
        pageCount: 0,
        mobileResponsive: false,
        sslValid: normalizedUrl.startsWith('https://'),
        hasContactForm: false,
        loadTimeMs: Date.now() - startTime,
        issues: [msg],
        auditedAt: now,
      };
    }
  }
}
