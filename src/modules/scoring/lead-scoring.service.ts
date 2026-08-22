import { prisma } from '../../database/index.js';
import { RuleBasedLeadScoringProvider } from './rule-based-scoring.provider.js';
import {
  LeadScoreResult,
  OfficialWebsiteConfidence,
} from '../../types/index.js';
import { logger } from '../../utils/logger.js';

export class LeadScoringService {
  private log = logger.child('LeadScoringService');
  private scorer = new RuleBasedLeadScoringProvider();

  /**
   * Scores a single business by its ID and saves the Lead record to SQLite.
   */
  public async scoreBusinessById(businessId: string): Promise<LeadScoreResult> {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: {
        audits: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
        contacts: true,
      },
    });

    if (!business) {
      throw new Error(`Business with ID ${businessId} not found.`);
    }

    const audit = business.audits[0] || null;
    const contacts = business.contacts.map((c) => ({
      email: c.email || undefined,
      contactName: c.contactName || undefined,
      role: c.role || undefined,
      source: c.source,
    }));

    const scoringResult = this.scorer.calculateScore({
      business: {
        name: business.name,
        category: business.category,
        city: business.city,
        address: business.address,
        phone: business.phone,
        website: business.website,
        source: business.source,
        officialWebsiteConfidence: (audit?.confidence as OfficialWebsiteConfidence) || 'MEDIUM',
      },
      audit: audit
        ? {
            website: audit.website,
            finalUrl: audit.finalUrl || undefined,
            status: audit.status as any,
            confidence: (audit.confidence as any) || 'MEDIUM',
            overallScore: audit.score,
            categories: {
              technical: audit.technicalScore || 0,
              mobile: audit.mobileScore || 0,
              performance: audit.performanceScore || 0,
              seo: audit.seoScore || 0,
              accessibility: audit.accessibilityScore || 0,
              ux: audit.uxScore || 0,
              content: audit.contentScore || 0,
            },
            opportunityFlags: audit.opportunityFlags ? JSON.parse(audit.opportunityFlags) : [],
            mobileAppOpportunity: (audit.mobileAppOpportunity as any) || 'LOW',
            mobileAppReasoning: audit.mobileAppReasoning ? JSON.parse(audit.mobileAppReasoning) : [],
            findings: audit.findings ? JSON.parse(audit.findings) : [],
            topProblems: audit.issuesJson ? JSON.parse(audit.issuesJson) : [],
            pageCount: audit.pageCount || 1,
            mobileResponsive: audit.mobileResponsive || false,
            sslValid: audit.sslValid || false,
            hasContactForm: audit.hasContactForm || false,
            loadTimeMs: audit.loadTimeMs || 0,
            issues: audit.issuesJson ? JSON.parse(audit.issuesJson) : [],
            auditedAt: audit.auditedAt || new Date(),
          }
        : null,
      contacts,
    });

    // Upsert Lead record in SQLite
    await prisma.lead.upsert({
      where: { businessId: business.id },
      create: {
        businessId: business.id,
        leadOpportunityScore: scoringResult.leadOpportunityScore,
        overallScore: scoringResult.overallScore,
        classification: scoringResult.classification,
        priority: scoringResult.priority,
        priorityRank: scoringResult.priorityRank,
        confidenceLevel: scoringResult.confidenceLevel,
        websiteOpportunityScore: scoringResult.breakdown.websiteOpportunity,
        commercialPotentialScore: scoringResult.breakdown.commercialPotential,
        contactabilityScore: scoringResult.breakdown.contactability,
        websiteProblemScore: scoringResult.breakdown.websiteProblem,
        mobileAppOpportunityScore: scoringResult.breakdown.mobileAppOpportunity,
        dataConfidenceScore: scoringResult.breakdown.dataConfidence,
        recommendedService: scoringResult.recommendedService,
        topOpportunitySignals: JSON.stringify(scoringResult.topOpportunitySignals),
        topProblems: JSON.stringify(scoringResult.topProblems),
        salesAngle: JSON.stringify(scoringResult.salesAngle),
        reasoning: JSON.stringify(scoringResult.reasoning),
        status: scoringResult.qualificationStatus === 'QUALIFIED' ? 'QUALIFIED' : 'DISQUALIFIED',
        scoredAt: new Date(),
      },
      update: {
        leadOpportunityScore: scoringResult.leadOpportunityScore,
        overallScore: scoringResult.overallScore,
        classification: scoringResult.classification,
        priority: scoringResult.priority,
        priorityRank: scoringResult.priorityRank,
        confidenceLevel: scoringResult.confidenceLevel,
        websiteOpportunityScore: scoringResult.breakdown.websiteOpportunity,
        commercialPotentialScore: scoringResult.breakdown.commercialPotential,
        contactabilityScore: scoringResult.breakdown.contactability,
        websiteProblemScore: scoringResult.breakdown.websiteProblem,
        mobileAppOpportunityScore: scoringResult.breakdown.mobileAppOpportunity,
        dataConfidenceScore: scoringResult.breakdown.dataConfidence,
        recommendedService: scoringResult.recommendedService,
        topOpportunitySignals: JSON.stringify(scoringResult.topOpportunitySignals),
        topProblems: JSON.stringify(scoringResult.topProblems),
        salesAngle: JSON.stringify(scoringResult.salesAngle),
        reasoning: JSON.stringify(scoringResult.reasoning),
        status: scoringResult.qualificationStatus === 'QUALIFIED' ? 'QUALIFIED' : 'DISQUALIFIED',
        scoredAt: new Date(),
      },
    });

    this.log.info(
      `Scored lead "${business.name}" -> Opportunity: ${scoringResult.leadOpportunityScore}/100, Class: ${scoringResult.classification}, Priority: Rank ${scoringResult.priorityRank} (${scoringResult.priority})`
    );

    return scoringResult;
  }

  /**
   * Scores a batch of businesses stored in the database.
   */
  public async scoreBatch(limit: number = 10): Promise<Array<{ business: { id: string; name: string; city: string; website: string | null }; score: LeadScoreResult }>> {
    const businesses = await prisma.business.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    const results = [];
    for (const biz of businesses) {
      const score = await this.scoreBusinessById(biz.id);
      results.push({
        business: { id: biz.id, name: biz.name, city: biz.city, website: biz.website },
        score,
      });
    }

    return results;
  }

  /**
   * Retrieves prioritized HOT leads sorted by priorityRank ASC, leadOpportunityScore DESC.
   */
  public async getHotLeads(limit: number = 20) {
    return prisma.lead.findMany({
      where: { classification: 'HOT' },
      include: {
        business: true,
      },
      orderBy: [
        { priorityRank: 'asc' },
        { leadOpportunityScore: 'desc' },
      ],
      take: limit,
    });
  }

  /**
   * Retrieves all scored leads sorted by priorityRank ASC, leadOpportunityScore DESC.
   */
  public async getPrioritizedLeads(limit: number = 20) {
    return prisma.lead.findMany({
      include: {
        business: true,
      },
      orderBy: [
        { priorityRank: 'asc' },
        { leadOpportunityScore: 'desc' },
      ],
      take: limit,
    });
  }
}
