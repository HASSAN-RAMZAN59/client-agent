import {
  WebsiteAuditProvider,
  ComprehensiveAuditResult,
} from '../../types/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Mock website audit provider for deterministic local testing.
 */
export class MockWebsiteAuditProvider implements WebsiteAuditProvider {
  public readonly providerName = 'MockWebsiteAuditProvider';
  private log = logger.child('MockAuditing');

  public async audit(
    websiteUrl: string,
    businessName: string = '',
    category: string = 'General'
  ): Promise<ComprehensiveAuditResult> {
    this.log.info(`Auditing website: "${websiteUrl}" (Provider: ${this.providerName})`);

    const now = new Date();

    if (!websiteUrl || websiteUrl.trim() === '') {
      return {
        website: '',
        status: 'NO_WEBSITE',
        confidence: 'HIGH',
        overallScore: 0.0,
        categories: { technical: 0, mobile: 0, performance: 0, seo: 0, accessibility: 0, ux: 0, content: 0 },
        opportunityFlags: ['NO_WEBSITE'],
        mobileAppOpportunity: 'LOW',
        mobileAppReasoning: ['Business does not have a registered website.'],
        findings: [],
        topProblems: ['No website found'],
        pageCount: 0,
        mobileResponsive: false,
        sslValid: false,
        hasContactForm: false,
        loadTimeMs: 0,
        issues: ['Business has no registered website.'],
        auditedAt: now,
      };
    }

    const isHttp = websiteUrl.startsWith('http://');
    const isFast = !websiteUrl.includes('law');

    const issues: string[] = [];
    let score = 75.0;

    if (isHttp) {
      issues.push('Insecure HTTP connection without SSL encryption');
      score -= 25.0;
    }

    if (!isFast) {
      issues.push('Slow initial server response time (> 3.2s)');
      issues.push('Poor mobile layout and horizontal overflow');
      score -= 20.0;
    }

    return {
      website: websiteUrl,
      finalUrl: websiteUrl,
      status: 'AUDITED',
      confidence: 'HIGH',
      overallScore: Math.max(10.0, score),
      categories: {
        technical: isHttp ? 50 : 90,
        mobile: isFast ? 85 : 45,
        performance: isFast ? 85 : 40,
        seo: 70,
        accessibility: 70,
        ux: 65,
        content: 80,
      },
      opportunityFlags: isFast ? [] : ['POOR_MOBILE', 'SLOW_LOADING'],
      mobileAppOpportunity: category.toLowerCase().includes('dentist') ? 'HIGH' : 'MEDIUM',
      mobileAppReasoning: ['Opportunity based on industry vertical self-service workflows.'],
      findings: issues.map((iss) => ({
        category: 'technical',
        title: iss,
        description: iss,
        severity: 'MEDIUM',
        evidence: iss,
      })),
      topProblems: issues,
      pageCount: 1,
      mobileResponsive: isFast,
      sslValid: !isHttp,
      hasContactForm: true,
      loadTimeMs: isFast ? 1100 : 3400,
      issues,
      auditedAt: now,
    };
  }
}
