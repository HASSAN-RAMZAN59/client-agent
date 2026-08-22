import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { analyzeSecurity } from '../src/modules/auditing/analyzers/security.analyzer.js';
import { analyzeMobile } from '../src/modules/auditing/analyzers/mobile.analyzer.js';
import { analyzePerformance } from '../src/modules/auditing/analyzers/performance.analyzer.js';
import { analyzeSeo } from '../src/modules/auditing/analyzers/seo.analyzer.js';
import { analyzeAccessibility } from '../src/modules/auditing/analyzers/accessibility.analyzer.js';
import { analyzeUxConversion } from '../src/modules/auditing/analyzers/ux-conversion.analyzer.js';
import { analyzeContent } from '../src/modules/auditing/analyzers/content.analyzer.js';
import { analyzeMobileAppOpportunity } from '../src/modules/auditing/analyzers/mobile-app-opportunity.analyzer.js';
import { computeAuditScoresAndFlags } from '../src/modules/auditing/analyzers/scorer.js';
import { HttpAuditProvider } from '../src/modules/auditing/http-audit.provider.js';
import { ComprehensiveWebsiteAuditService } from '../src/modules/auditing/comprehensive-website-audit.service.js';
import { prisma } from '../src/database/index.js';

describe('Phase 3: Website Intelligence & Audit Engine', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Security Analyzer', () => {
    it('should penalize insecure HTTP URLs', () => {
      const result = analyzeSecurity('http://exampledental.com', '<html></html>');
      expect(result.isHttps).toBe(false);
      expect(result.score).toBeLessThanOrEqual(40);
      expect(result.findings.some((f) => f.title.includes('Insecure Connection'))).toBe(true);
    });

    it('should detect mixed content in HTTPS pages', () => {
      const html = '<html><head><script src="http://insecure-cdn.com/app.js"></script></head></html>';
      const result = analyzeSecurity('https://exampledental.com', html);
      expect(result.isHttps).toBe(true);
      expect(result.hasMixedContent).toBe(true);
      expect(result.score).toBeLessThan(100);
      expect(result.findings.some((f) => f.title.includes('Mixed Content'))).toBe(true);
    });
  });

  describe('Mobile Responsiveness Analyzer', () => {
    it('should detect missing mobile viewport meta tag', () => {
      const result = analyzeMobile({ hasViewportMeta: false });
      expect(result.mobileResponsive).toBe(false);
      expect(result.score).toBe(40);
      expect(result.findings.some((f) => f.title.includes('Missing Mobile Viewport'))).toBe(true);
    });

    it('should penalize horizontal layout overflow', () => {
      const result = analyzeMobile({
        hasViewportMeta: true,
        viewportContent: 'width=device-width, initial-scale=1.0',
        hasHorizontalOverflow: true,
        scrollWidth: 520,
        innerWidth: 390,
      });
      expect(result.score).toBe(60);
      expect(result.findings.some((f) => f.title.includes('Horizontal Layout Overflow'))).toBe(true);
    });
  });

  describe('Performance Analyzer', () => {
    it('should flag page load latency exceeding 4.5 seconds', () => {
      const result = analyzePerformance({ loadTimeMs: 4800 });
      expect(result.score).toBeLessThanOrEqual(45);
      expect(result.findings.some((f) => f.title.includes('Critical Page Load Latency'))).toBe(true);
    });

    it('should reward fast sub-1.5 second load times', () => {
      const result = analyzePerformance({ loadTimeMs: 900 });
      expect(result.score).toBe(100);
      expect(result.findings).toHaveLength(0);
    });
  });

  describe('SEO Analyzer', () => {
    it('should detect missing title and meta description', () => {
      const result = analyzeSeo({
        title: '',
        metaDescription: '',
        h1List: [],
        hasRobotsMetaNoindex: false,
        totalImages: 5,
        imagesWithAlt: 5,
      });
      expect(result.score).toBeLessThanOrEqual(30);
      expect(result.findings.some((f) => f.title.includes('Missing Page Title Tag'))).toBe(true);
      expect(result.findings.some((f) => f.title.includes('Missing Meta Description'))).toBe(true);
    });

    it('should heavily penalize noindex blocking on homepage', () => {
      const result = analyzeSeo({
        title: 'Dallas Dentist Clinic',
        metaDescription: 'Top dental services in Dallas.',
        h1List: ['Welcome to Dallas Dental'],
        hasRobotsMetaNoindex: true,
        totalImages: 2,
        imagesWithAlt: 2,
      });
      expect(result.score).toBeLessThanOrEqual(50);
      expect(result.findings.some((f) => f.title.includes('noindex'))).toBe(true);
    });
  });

  describe('Accessibility Analyzer', () => {
    it('should penalize unlabeled form inputs and missing image alts', () => {
      const result = analyzeAccessibility({
        totalImages: 4,
        imagesWithAlt: 1,
        unlabeledButtonsCount: 2,
        emptyLinksCount: 1,
        unlabeledInputsCount: 3,
      });
      expect(result.score).toBeLessThanOrEqual(40);
      expect(result.findings.some((f) => f.title.includes('Form Inputs Missing'))).toBe(true);
      expect(result.findings.some((f) => f.title.includes('Images Missing Alt Text'))).toBe(true);
    });
  });

  describe('UX & Conversion Analyzer', () => {
    it('should detect missing phone number and conversion CTAs', () => {
      const result = analyzeUxConversion({
        hasClickablePhone: false,
        hasVisiblePhoneText: false,
        hasContactForm: false,
        hasBookingCta: false,
        hasQuoteCta: false,
        hasContactCta: false,
        hasPhysicalAddress: false,
        hasBusinessHours: false,
        hasSocialLinks: false,
      });
      expect(result.score).toBeLessThanOrEqual(25);
      expect(result.findings.some((f) => f.title.includes('Missing Direct Call-to-Action / Phone'))).toBe(true);
      expect(result.findings.some((f) => f.title.includes('No Clear Conversion Call-to-Action'))).toBe(true);
    });
  });

  describe('Content Analyzer', () => {
    it('should detect template placeholder text like Lorem Ipsum', () => {
      const result = analyzeContent({
        bodyWordCount: 250,
        hasPlaceholderText: true,
        placeholderMatches: ['lorem ipsum', 'dolor sit amet'],
        hasEmptySections: false,
      });
      expect(result.score).toBe(50);
      expect(result.findings.some((f) => f.title.includes('Placeholder / Demo Content'))).toBe(true);
    });

    it('should flag critically thin homepage content', () => {
      const result = analyzeContent({
        bodyWordCount: 45,
        hasPlaceholderText: false,
        placeholderMatches: [],
        hasEmptySections: false,
      });
      expect(result.score).toBeLessThanOrEqual(60);
      expect(result.findings.some((f) => f.title.includes('Critically Thin Homepage Content'))).toBe(true);
    });
  });

  describe('Mobile App Opportunity Analyzer', () => {
    it('should assign HIGH opportunity for interactive booking/ordering medical services', () => {
      const result = analyzeMobileAppOpportunity({
        category: 'Dentist',
        hasBooking: true,
        hasOrderingOrMenu: false,
        hasCustomerPortal: true,
        hasLoyaltyRewards: false,
        hasRecurringMembership: false,
        hasComplexWorkflow: false,
      });
      expect(result.level).toBe('HIGH');
      expect(result.reasoning.length).toBeGreaterThanOrEqual(2);
    });

    it('should assign LOW opportunity for pure brochure static presence', () => {
      const result = analyzeMobileAppOpportunity({
        category: 'Consultant',
        hasBooking: false,
        hasOrderingOrMenu: false,
        hasCustomerPortal: false,
        hasLoyaltyRewards: false,
        hasRecurringMembership: false,
        hasComplexWorkflow: false,
      });
      expect(result.level).toBe('LOW');
    });
  });

  describe('Composite Scoring & Opportunity Flags', () => {
    it('should compute weighted score and derive opportunity flags', () => {
      const comp = computeAuditScoresAndFlags({
        technicalScore: 80,
        mobileScore: 50, // < 65 -> POOR_MOBILE
        performanceScore: 45, // < 60 -> SLOW_LOADING
        seoScore: 55, // < 60 -> WEAK_SEO
        accessibilityScore: 50, // < 60 -> ACCESSIBILITY_ISSUES
        uxScore: 35, // < 40 -> NO_CONTACT_METHOD, NO_CLEAR_CTA
        contentScore: 50, // < 60 -> THIN_CONTENT
        findings: [
          {
            category: 'ux',
            title: 'No Booking CTA Found',
            description: 'No online booking found',
            severity: 'HIGH',
            evidence: 'None',
          },
        ],
      });

      expect(comp.overallScore).toBeLessThan(60);
      expect(comp.opportunityFlags).toContain('POOR_MOBILE');
      expect(comp.opportunityFlags).toContain('SLOW_LOADING');
      expect(comp.opportunityFlags).toContain('WEAK_SEO');
      expect(comp.opportunityFlags).toContain('NO_BOOKING');
      expect(comp.topProblems.length).toBeGreaterThan(0);
    });
  });

  describe('Level 1 HTTP Audit Provider', () => {
    it('should audit valid HTML response and return structured intelligence', async () => {
      const sampleHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Apex Dental Clinic - Dallas Dentist</title>
          <meta name="description" content="Comprehensive family and cosmetic dentistry in North Dallas. Call today." />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <link rel="canonical" href="https://apexdentaldallas.com" />
        </head>
        <body>
          <h1>Apex Dental Dallas</h1>
          <p>Welcome to our Dallas dental practice. We provide preventive, cosmetic, and emergency dental treatments.</p>
          <a href="tel:+12145550199">Call (214) 555-0199</a>
          <a href="/booking">Book Appointment Online</a>
          <form action="/contact" method="post">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" />
            <button type="submit">Send Message</button>
          </form>
          <img src="/logo.png" alt="Apex Dental Logo" />
        </body>
        </html>
      `;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://apexdentaldallas.com',
        text: async () => sampleHtml,
      } as unknown as Response);

      const provider = new HttpAuditProvider();
      const result = await provider.audit('https://apexdentaldallas.com', {
        businessName: 'Apex Dental',
        category: 'Dentist',
      });

      expect(result.status).toBe('AUDITED');
      expect(result.confidence).toBe('HIGH');
      expect(result.overallScore).toBeGreaterThanOrEqual(80);
      expect(result.categories.technical).toBe(100);
      expect(result.categories.mobile).toBe(100);
      expect(result.sslValid).toBe(true);
      expect(result.hasContactForm).toBe(true);
      expect(result.mobileAppOpportunity).toBe('HIGH');
    });

    it('should classify HTTP 403 / 429 WAF challenges as BLOCKED status', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        url: 'https://protecteddental.com',
      } as unknown as Response);

      const provider = new HttpAuditProvider();
      const result = await provider.audit('https://protecteddental.com');

      expect(result.status).toBe('BLOCKED');
      expect(result.confidence).toBe('LOW');
      expect(result.findings.some((f) => f.title.includes('WAF'))).toBe(true);
    });

    it('should handle missing website inputs with NO_WEBSITE status and zero network requests', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      const provider = new HttpAuditProvider();
      const result = await provider.audit('');

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.status).toBe('NO_WEBSITE');
      expect(result.overallScore).toBe(0);
      expect(result.opportunityFlags).toContain('NO_WEBSITE');
    });
  });

  describe('Comprehensive Website Audit Service & SQLite Persistence', () => {
    it('should audit a business by ID and persist audit record into SQLite', async () => {
      const testBusiness = await prisma.business.create({
        data: {
          name: `Audit Test Biz ${Date.now()}`,
          category: 'Dentist',
          city: 'Dallas',
          website: 'https://unittestdental.com',
          source: 'test',
        },
      });

      const sampleHtml = `
        <html>
        <head><title>Unit Test Dental</title><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
        <body>
          <h1>Unit Test Dental Dallas</h1>
          <p>Providing dental care in Dallas Texas.</p>
          <a href="tel:2145551122">(214) 555-1122</a>
        </body>
        </html>
      `;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://unittestdental.com',
        text: async () => sampleHtml,
      } as unknown as Response);

      const service = new ComprehensiveWebsiteAuditService();
      const auditResult = await service.auditBusinessById(testBusiness.id);

      expect(auditResult.status).toBe('AUDITED');

      // Verify saved in SQLite database
      const saved = await prisma.websiteAudit.findFirst({
        where: { businessId: testBusiness.id },
      });

      expect(saved).toBeDefined();
      expect(saved?.score).toBe(auditResult.overallScore);
      expect(saved?.status).toBe('AUDITED');
      expect(saved?.technicalScore).toBeDefined();
      expect(saved?.mobileScore).toBeDefined();
      expect(saved?.opportunityFlags).toBeDefined();
    });
  });
});
