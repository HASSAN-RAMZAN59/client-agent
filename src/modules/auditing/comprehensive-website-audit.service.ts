import { prisma } from '../../database/index.js';
import {
  ComprehensiveAuditResult,
  WebsiteAuditProvider,
} from '../../types/index.js';
import { BrowserAuditProvider } from './browser-audit.provider.js';
import { HttpAuditProvider } from './http-audit.provider.js';
import { safetyControls } from '../../config/safety.js';
import { logger } from '../../utils/logger.js';

export interface AuditExecutionOptions {
  force?: boolean;
  dryRun?: boolean;
}

export class ComprehensiveWebsiteAuditService implements WebsiteAuditProvider {
  public readonly providerName = 'ComprehensiveWebsiteAuditService';
  private log = logger.child('ComprehensiveWebsiteAuditService');
  private browserAudit = new BrowserAuditProvider();
  private httpAudit = new HttpAuditProvider();

  public async audit(
    websiteUrl: string,
    businessName: string = '',
    category: string = 'General'
  ): Promise<ComprehensiveAuditResult> {
    const policy = safetyControls.getPolicy();

    if (!websiteUrl || websiteUrl.trim().length === 0) {
      return this.httpAudit.audit('', { businessName, category });
    }

    if (policy.auditHeadless) {
      return this.browserAudit.audit(websiteUrl, {
        businessName,
        category,
        maxPages: policy.auditMaxPagesPerSite,
      });
    }

    return this.httpAudit.audit(websiteUrl, {
      businessName,
      category,
      timeoutMs: policy.auditPageTimeoutMs,
    });
  }

  /**
   * Audits a specific business from the database and persists findings.
   */
  public async auditBusinessById(
    businessId: string,
    options: AuditExecutionOptions = {}
  ): Promise<ComprehensiveAuditResult> {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
    });

    if (!business) {
      throw new Error(`Business with ID ${businessId} not found.`);
    }

    const policy = safetyControls.getPolicy();

    // Check for recent existing audit unless force=true
    if (!options.force) {
      const existing = await prisma.websiteAudit.findFirst({
        where: { businessId: business.id },
        orderBy: { updatedAt: 'desc' },
      });

      if (existing && existing.auditedAt) {
        const ageInDays = (Date.now() - existing.auditedAt.getTime()) / (1000 * 60 * 60 * 24);
        if (ageInDays < policy.auditReAuditIntervalDays && existing.status !== 'PENDING') {
          this.log.info(`Using cached audit for "${business.name}" (Audited ${Math.round(ageInDays)}d ago)`);

          return {
            website: existing.website,
            finalUrl: existing.finalUrl || undefined,
            status: existing.status as any,
            confidence: (existing.confidence as any) || 'MEDIUM',
            overallScore: existing.score,
            categories: {
              technical: existing.technicalScore || 0,
              mobile: existing.mobileScore || 0,
              performance: existing.performanceScore || 0,
              seo: existing.seoScore || 0,
              accessibility: existing.accessibilityScore || 0,
              ux: existing.uxScore || 0,
              content: existing.contentScore || 0,
            },
            opportunityFlags: existing.opportunityFlags ? JSON.parse(existing.opportunityFlags) : [],
            mobileAppOpportunity: (existing.mobileAppOpportunity as any) || 'LOW',
            mobileAppReasoning: existing.mobileAppReasoning ? JSON.parse(existing.mobileAppReasoning) : [],
            findings: existing.findings ? JSON.parse(existing.findings) : [],
            topProblems: existing.issuesJson ? JSON.parse(existing.issuesJson) : [],
            pageCount: existing.pageCount || 1,
            mobileResponsive: existing.mobileResponsive || false,
            sslValid: existing.sslValid || false,
            hasContactForm: existing.hasContactForm || false,
            loadTimeMs: existing.loadTimeMs || 0,
            issues: existing.issuesJson ? JSON.parse(existing.issuesJson) : [],
            auditedAt: existing.auditedAt,
          };
        }
      }
    }

    this.log.info(`Executing website audit for "${business.name}" (URL: ${business.website || 'None'})`);

    const result = await this.audit(business.website || '', business.name, business.category);

    // Persist into SQLite unless dryRun is set
    if (!options.dryRun) {
      await prisma.websiteAudit.upsert({
        where: {
          id: (await prisma.websiteAudit.findFirst({ where: { businessId: business.id } }))?.id || 'none',
        },
        create: {
          businessId: business.id,
          website: result.website || '',
          finalUrl: result.finalUrl,
          status: result.status,
          confidence: result.confidence,
          score: result.overallScore,
          technicalScore: result.categories.technical,
          mobileScore: result.categories.mobile,
          performanceScore: result.categories.performance,
          seoScore: result.categories.seo,
          accessibilityScore: result.categories.accessibility,
          uxScore: result.categories.ux,
          contentScore: result.categories.content,
          opportunityFlags: JSON.stringify(result.opportunityFlags),
          mobileAppOpportunity: result.mobileAppOpportunity,
          mobileAppReasoning: JSON.stringify(result.mobileAppReasoning),
          findings: JSON.stringify(result.findings),
          pageCount: result.pageCount,
          mobileResponsive: result.mobileResponsive,
          sslValid: result.sslValid,
          hasContactForm: result.hasContactForm,
          loadTimeMs: result.loadTimeMs,
          issuesJson: JSON.stringify(result.topProblems),
          auditedAt: result.auditedAt,
        },
        update: {
          website: result.website || '',
          finalUrl: result.finalUrl,
          status: result.status,
          confidence: result.confidence,
          score: result.overallScore,
          technicalScore: result.categories.technical,
          mobileScore: result.categories.mobile,
          performanceScore: result.categories.performance,
          seoScore: result.categories.seo,
          accessibilityScore: result.categories.accessibility,
          uxScore: result.categories.ux,
          contentScore: result.categories.content,
          opportunityFlags: JSON.stringify(result.opportunityFlags),
          mobileAppOpportunity: result.mobileAppOpportunity,
          mobileAppReasoning: JSON.stringify(result.mobileAppReasoning),
          findings: JSON.stringify(result.findings),
          pageCount: result.pageCount,
          mobileResponsive: result.mobileResponsive,
          sslValid: result.sslValid,
          hasContactForm: result.hasContactForm,
          loadTimeMs: result.loadTimeMs,
          issuesJson: JSON.stringify(result.topProblems),
          auditedAt: result.auditedAt,
        },
      });
    }

    return result;
  }

  /**
   * Audits multiple businesses up to limit.
   */
  public async auditDiscoveredBatch(
    limit: number = 5,
    options: AuditExecutionOptions & { onlyWithWebsites?: boolean } = {}
  ): Promise<Array<{ business: { id: string; name: string }; audit: ComprehensiveAuditResult }>> {
    const businesses = await prisma.business.findMany({
      where: options.onlyWithWebsites ? { website: { not: null } } : undefined,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    const results: Array<{ business: { id: string; name: string }; audit: ComprehensiveAuditResult }> = [];

    for (const biz of businesses) {
      const auditRes = await this.auditBusinessById(biz.id, options);
      results.push({
        business: { id: biz.id, name: biz.name },
        audit: auditRes,
      });
    }

    return results;
  }
}
