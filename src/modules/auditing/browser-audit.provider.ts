import { chromium, Browser, Page } from 'playwright';
import {
  ComprehensiveAuditResult,
  AuditFinding,
} from '../../types/index.js';
import { HttpAuditProvider } from './http-audit.provider.js';
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
import { safetyControls } from '../../config/safety.js';
import { logger } from '../../utils/logger.js';

export interface BrowserAuditOptions {
  businessName?: string;
  category?: string;
  maxPages?: number;
}

export class BrowserAuditProvider {
  private log = logger.child('BrowserAuditProvider');
  private httpFallback = new HttpAuditProvider();

  public async audit(
    url: string,
    options: BrowserAuditOptions = {}
  ): Promise<ComprehensiveAuditResult> {
    const policy = safetyControls.getPolicy();
    const normalizedUrl = normalizeUrl(url) || url;
    const businessName = options.businessName || '';
    const category = options.category || 'General Service';
    const now = new Date();

    if (!normalizedUrl || normalizedUrl.trim().length === 0) {
      return this.httpFallback.audit('', options);
    }

    let browser: Browser | null = null;

    try {
      this.log.info(`Launching Playwright mobile browser audit for ${normalizedUrl}`);

      browser = await chromium.launch({
        headless: policy.auditHeadless,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      const context = await browser.newContext({
        viewport: {
          width: policy.auditViewportWidth,
          height: policy.auditViewportHeight,
        },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1 (Antigravity-Audit/1.0)',
        isMobile: true,
        hasTouch: true,
      });

      const page: Page = await context.newPage();
      page.setDefaultNavigationTimeout(policy.auditPageTimeoutMs);
      page.setDefaultTimeout(policy.auditPageTimeoutMs);

      // Block heavy media assets to protect network bandwidth
      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (resourceType === 'media' || resourceType === 'websocket') {
          return route.abort();
        }
        return route.continue();
      });

      const startTime = Date.now();
      let response = null;

      try {
        response = await page.goto(normalizedUrl, {
          waitUntil: 'domcontentloaded',
          timeout: policy.auditPageTimeoutMs,
        });
      } catch (navErr: unknown) {
        const navMsg = navErr instanceof Error ? navErr.message : String(navErr);
        this.log.warn(`Playwright navigation challenge for ${normalizedUrl}: ${navMsg}`);

        if (navMsg.toLowerCase().includes('timeout')) {
          await browser.close();
          return {
            website: normalizedUrl,
            status: 'TIMEOUT',
            confidence: 'LOW',
            overallScore: 25,
            categories: { technical: 25, mobile: 25, performance: 25, seo: 25, accessibility: 25, ux: 25, content: 25 },
            opportunityFlags: ['SLOW_LOADING'],
            mobileAppOpportunity: 'LOW',
            mobileAppReasoning: ['Browser navigation timed out.'],
            findings: [{
              category: 'performance',
              title: 'Browser Navigation Timeout',
              description: `Page failed to load within ${policy.auditPageTimeoutMs}ms.`,
              severity: 'HIGH',
              evidence: navMsg,
            }],
            topProblems: ['Browser navigation timeout'],
            pageCount: 0,
            mobileResponsive: false,
            sslValid: normalizedUrl.startsWith('https://'),
            hasContactForm: false,
            loadTimeMs: policy.auditPageTimeoutMs,
            issues: [navMsg],
            auditedAt: now,
          };
        }

        // Fallback to Level 1 HTTP analyzer
        await browser.close();
        return this.httpFallback.audit(normalizedUrl, options);
      }

      const loadTimeMs = Date.now() - startTime;
      const finalUrl = page.url();
      const status = response ? response.status() : 200;

      // Detect Cloudflare / WAF block
      if (status === 403 || status === 429) {
        await browser.close();
        return {
          website: normalizedUrl,
          finalUrl,
          status: 'BLOCKED',
          confidence: 'LOW',
          overallScore: 50,
          categories: { technical: 50, mobile: 50, performance: 50, seo: 50, accessibility: 50, ux: 50, content: 50 },
          opportunityFlags: [],
          mobileAppOpportunity: 'MEDIUM',
          mobileAppReasoning: ['Page rendered with HTTP 403/429 firewall challenge.'],
          findings: [{
            category: 'technical',
            title: 'Automated Audit Blocked by Server (WAF)',
            description: 'The server returned HTTP 403/429 challenge. Website is active but protected by anti-bot firewall.',
            severity: 'INFO',
            evidence: `HTTP status ${status}`,
          }],
          topProblems: ['Audit probe challenged by WAF'],
          pageCount: 1,
          mobileResponsive: true,
          sslValid: finalUrl.startsWith('https://'),
          hasContactForm: false,
          loadTimeMs,
          issues: [`Server returned HTTP ${status} (Protected by WAF)`],
          auditedAt: now,
        };
      }

      // Extract client-side evaluation metrics inside browser context
      const domData = await page.evaluate(() => {
        const docEl = document.documentElement;
        const scrollWidth = docEl.scrollWidth || document.body.scrollWidth;
        const innerWidth = window.innerWidth;
        const hasHorizontalOverflow = scrollWidth > innerWidth + 5;

        const title = document.title || '';
        const metaDescEl = document.querySelector('meta[name="description"]');
        const metaDescription = metaDescEl ? metaDescEl.getAttribute('content') || '' : '';
        const viewportEl = document.querySelector('meta[name="viewport"]');
        const viewportContent = viewportEl ? viewportEl.getAttribute('content') || '' : '';
        const canonicalEl = document.querySelector('link[rel="canonical"]');
        const canonicalUrl = canonicalEl ? canonicalEl.getAttribute('href') || '' : '';
        const robotsEl = document.querySelector('meta[name="robots"]');
        const robotsMeta = robotsEl ? robotsEl.getAttribute('content') || '' : '';

        const h1s: string[] = [];
        document.querySelectorAll('h1').forEach((el: Element) => {
          const t = el.textContent?.trim();
          if (t) h1s.push(t);
        });

        const imgs = document.querySelectorAll('img');
        let withAlt = 0;
        imgs.forEach((img: Element) => {
          if (img.getAttribute('alt')) withAlt++;
        });

        let unlabeledButtons = 0;
        document.querySelectorAll('button').forEach((b: Element) => {
          if (!b.textContent?.trim() && !b.getAttribute('aria-label')) unlabeledButtons++;
        });

        let emptyLinks = 0;
        document.querySelectorAll('a').forEach((a: Element) => {
          if (a.getAttribute('href') && !a.textContent?.trim() && !a.getAttribute('aria-label')) emptyLinks++;
        });

        let unlabeledInputs = 0;
        document.querySelectorAll('input:not([type="hidden"]):not([type="submit"])').forEach((inp: Element) => {
          const id = inp.getAttribute('id');
          const hasLabel = id ? Boolean(document.querySelector(`label[for="${id}"]`)) : false;
          if (!inp.getAttribute('aria-label') && !hasLabel) unlabeledInputs++;
        });

        const fullText = document.body.innerText || '';
        const words = fullText.split(/\s+/).filter((w: string) => w.length > 0);

        const hasClickablePhone = document.querySelectorAll('a[href^="tel:"]').length > 0;
        const hasContactForm = document.querySelectorAll('form input[type="email"], form textarea').length > 0;

        // Find secondary booking or contact link if present
        let secondaryLink: string | null = null;
        const links = Array.from(document.querySelectorAll('a[href]'));
        for (const l of links) {
          const anchor = l as HTMLAnchorElement;
          const href = anchor.getAttribute('href') || '';
          const txt = (anchor.textContent || '').toLowerCase();
          if ((txt.includes('book') || txt.includes('contact') || txt.includes('about')) && (href.startsWith('http') || href.startsWith('/'))) {
            secondaryLink = href;
            break;
          }
        }

        return {
          scrollWidth,
          innerWidth,
          hasHorizontalOverflow,
          title,
          metaDescription,
          viewportContent,
          canonicalUrl,
          robotsMeta,
          h1s,
          totalImages: imgs.length,
          imagesWithAlt: withAlt,
          unlabeledButtons,
          emptyLinks,
          unlabeledInputs,
          fullText,
          wordCount: words.length,
          hasClickablePhone,
          hasContactForm,
          secondaryLink,
        };
      });

      await browser.close();
      browser = null;

      const fullTextLower = domData.fullText.toLowerCase();
      const phoneRegex = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
      const hasVisiblePhoneText = phoneRegex.test(domData.fullText);

      const hasBookingCta = fullTextLower.includes('book appointment') || fullTextLower.includes('schedule online') || fullTextLower.includes('book now');
      const hasQuoteCta = fullTextLower.includes('request quote') || fullTextLower.includes('free estimate') || fullTextLower.includes('get a quote');
      const hasContactCta = fullTextLower.includes('contact us') || fullTextLower.includes('get in touch') || Boolean(domData.secondaryLink);
      const hasPhysicalAddress = /\b\d{1,5}\s+[\w\s.]+(?:street|st|avenue|ave|road|rd|blvd|boulevard|suite|ste|pkwy)\b/i.test(domData.fullText);
      const hasBusinessHours = fullTextLower.includes('monday') || fullTextLower.includes('hours') || fullTextLower.includes('open:');
      const hasSocialLinks = fullTextLower.includes('facebook.com') || fullTextLower.includes('instagram.com');

      const placeholderTerms = ['lorem ipsum', 'dolor sit amet', 'sample text', 'placeholder', 'under construction'];
      const matchedPlaceholders = placeholderTerms.filter((term) => fullTextLower.includes(term));

      // Run Analyzers
      const secRes = analyzeSecurity(finalUrl, '');
      const mobRes = analyzeMobile({
        hasViewportMeta: Boolean(domData.viewportContent),
        viewportContent: domData.viewportContent,
        hasHorizontalOverflow: domData.hasHorizontalOverflow,
        scrollWidth: domData.scrollWidth,
        innerWidth: domData.innerWidth,
      });
      const perfRes = analyzePerformance({
        loadTimeMs,
      });
      const seoRes = analyzeSeo({
        title: domData.title,
        metaDescription: domData.metaDescription,
        h1List: domData.h1s,
        canonicalUrl: domData.canonicalUrl,
        hasRobotsMetaNoindex: domData.robotsMeta.toLowerCase().includes('noindex'),
        totalImages: domData.totalImages,
        imagesWithAlt: domData.imagesWithAlt,
      });
      const a11yRes = analyzeAccessibility({
        totalImages: domData.totalImages,
        imagesWithAlt: domData.imagesWithAlt,
        unlabeledButtonsCount: domData.unlabeledButtons,
        emptyLinksCount: domData.emptyLinks,
        unlabeledInputsCount: domData.unlabeledInputs,
      });
      const uxRes = analyzeUxConversion({
        hasClickablePhone: domData.hasClickablePhone,
        hasVisiblePhoneText,
        hasContactForm: domData.hasContactForm,
        hasBookingCta,
        hasQuoteCta,
        hasContactCta,
        hasPhysicalAddress,
        hasBusinessHours,
        hasSocialLinks,
      });
      const contentRes = analyzeContent({
        bodyWordCount: domData.wordCount,
        hasPlaceholderText: matchedPlaceholders.length > 0,
        placeholderMatches: matchedPlaceholders,
        hasEmptySections: false,
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
      if (browser) {
        await browser.close().catch(() => {});
      }
      this.log.warn(`Browser audit failed, delegating to HTTP audit: ${err}`);
      return this.httpFallback.audit(normalizedUrl, options);
    }
  }
}
