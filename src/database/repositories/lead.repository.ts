import { PrismaClient, Lead, Prisma } from '@prisma/client';
import { getPrismaClient } from '../client.js';
import { LeadScoreResult, PriorityLevel, LeadStatus } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

export type LeadWithRelations = Prisma.LeadGetPayload<{
  include: {
    business: {
      include: {
        contacts: true;
        audits: true;
      };
    };
    outreach: true;
  };
}>;

export class LeadRepository {
  private db: PrismaClient;
  private log = logger.child('LeadRepository');

  constructor(client: PrismaClient = getPrismaClient()) {
    this.db = client;
  }

  /**
   * Creates or updates a lead assessment for a business.
   */
  public async createOrUpdateLead(params: {
    businessId: string;
    scoring: LeadScoreResult;
    status?: LeadStatus;
    notes?: string;
  }): Promise<Lead> {
    const existing = await this.db.lead.findFirst({
      where: { businessId: params.businessId },
    });

    const leadData = {
      priority: params.scoring.priority as PriorityLevel,
      priorityRank: params.scoring.priorityRank,
      classification: params.scoring.classification,
      confidenceLevel: params.scoring.confidenceLevel,
      leadOpportunityScore: params.scoring.leadOpportunityScore,
      overallScore: params.scoring.overallScore,
      websiteOpportunityScore: params.scoring.websiteOpportunityScore,
      commercialPotentialScore: params.scoring.breakdown.commercialPotential,
      contactabilityScore: params.scoring.breakdown.contactability,
      websiteProblemScore: params.scoring.breakdown.websiteProblem,
      mobileAppOpportunityScore: params.scoring.breakdown.mobileAppOpportunity,
      dataConfidenceScore: params.scoring.breakdown.dataConfidence,
      recommendedService: params.scoring.recommendedService,
      topOpportunitySignals: JSON.stringify(params.scoring.topOpportunitySignals),
      topProblems: JSON.stringify(params.scoring.topProblems),
      salesAngle: JSON.stringify(params.scoring.salesAngle),
      reasoning: JSON.stringify(params.scoring.reasoning),
      status: params.status || (params.scoring.qualificationStatus === 'QUALIFIED' ? 'QUALIFIED' : 'DISQUALIFIED'),
      notes: params.notes || params.scoring.reasoning.join('; '),
      scoredAt: new Date(),
    };

    if (existing) {
      this.log.debug(`Updating existing lead for business ${params.businessId}`);
      return this.db.lead.update({
        where: { id: existing.id },
        data: leadData,
      });
    }

    const lead = await this.db.lead.create({
      data: {
        businessId: params.businessId,
        ...leadData,
      },
    });

    this.log.info(
      `Lead created [${lead.id}] -> Opportunity: ${lead.leadOpportunityScore}/100, Class: ${lead.classification}, Rank: ${lead.priorityRank}`
    );
    return lead;
  }

  public async getQualifiedLeads(limit: number = 20): Promise<LeadWithRelations[]> {
    return this.db.lead.findMany({
      where: {
        status: { in: ['NEW', 'QUALIFIED'] },
      },
      orderBy: [{ priorityRank: 'asc' }, { leadOpportunityScore: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: {
        business: {
          include: {
            contacts: true,
            audits: true,
          },
        },
        outreach: true,
      },
    });
  }

  public async count(): Promise<number> {
    return this.db.lead.count();
  }
}
