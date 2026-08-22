import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';
import { CampaignRepository } from '../../database/repositories/campaign.repository.js';
import { BusinessRepository } from '../../database/repositories/business.repository.js';
import { OutreachRepository } from '../../database/repositories/outreach.repository.js';
import { SuppressionRepository } from '../../database/repositories/suppression.repository.js';
import { WebSearchDiscoveryProvider } from '../discovery/web-search-discovery.provider.js';
import { MockBusinessDiscoveryProvider } from '../discovery/mock-discovery.provider.js';
import { ComprehensiveWebsiteAuditService } from '../auditing/comprehensive-website-audit.service.js';
import { LeadScoringService } from '../scoring/lead-scoring.service.js';
import { ContactDiscoveryService } from '../contact-discovery/contact-discovery.service.js';
import { PersonalizationService } from '../personalization/personalization.service.js';
import { OutreachGateService } from '../personalization/hardening/outreach-gate.service.js';
import { funnelAnalyticsService } from './funnel-analytics.service.js';
import {
  CampaignInput,
  CampaignRecord,
  CampaignPacingSummary,
  CampaignFunnelSummary,
} from '../../types/index.js';
import { safetyControls } from '../../config/safety.js';
import { logger } from '../../utils/logger.js';

export interface CampaignRunResult {
  campaignId: string;
  campaignName: string;
  discovered: number;
  newBusinesses: number;
  audited: number;
  leadsScored: number;
  qualifiedLeads: number;
  contactsFound: number;
  draftsGenerated: number;
  approvedCount: number;
  readyToSendCount: number;
  sentCount: number;
  durationMs: number;
}

export interface CampaignReportResult {
  campaign: CampaignRecord;
  funnel: CampaignFunnelSummary;
  pacing: CampaignPacingSummary;
  leadTemperatures: {
    hot: number;
    warm: number;
    cold: number;
    disqualified: number;
  };
  serviceBreakdown: Record<string, number>;
  reviewStatus: {
    draft: number;
    reviewRequired: number;
    approved: number;
    readyToSend: number;
    sent: number;
    rejected: number;
    suppressed: number;
  };
}

export class CampaignService {
  private db: PrismaClient;
  private campaignRepo: CampaignRepository;
  private businessRepo: BusinessRepository;
  private auditService: ComprehensiveWebsiteAuditService;
  private scoringService: LeadScoringService;
  private contactService: ContactDiscoveryService;
  private personalizationService: PersonalizationService;
  private gateService: OutreachGateService;
  private log = logger.child('CampaignService');

  constructor(customDb?: PrismaClient) {
    this.db = customDb || getPrismaClient();
    this.campaignRepo = new CampaignRepository(this.db);
    this.businessRepo = new BusinessRepository(this.db);
    this.auditService = new ComprehensiveWebsiteAuditService();
    this.scoringService = new LeadScoringService();
    this.contactService = new ContactDiscoveryService();
    this.personalizationService = new PersonalizationService();
    this.gateService = new OutreachGateService(new OutreachRepository(this.db), new SuppressionRepository(this.db));
  }

  public async createCampaign(input: CampaignInput): Promise<CampaignRecord> {
    return this.campaignRepo.createCampaign(input);
  }

  public async getCampaign(id: string): Promise<CampaignRecord | null> {
    return this.campaignRepo.getCampaignById(id);
  }

  public async listCampaigns(): Promise<CampaignRecord[]> {
    return this.campaignRepo.listCampaigns();
  }

  public async runCampaignPipeline(
    campaignId: string,
    options?: { mock?: boolean; maxItems?: number }
  ): Promise<CampaignRunResult> {
    const startTime = Date.now();
    const campaign = await this.campaignRepo.getCampaignById(campaignId);
    if (!campaign) {
      throw new Error(`Campaign "${campaignId}" not found`);
    }

    const policy = safetyControls.getPolicy();
    const maxItems = Math.min(
      options?.maxItems ?? campaign.maxDiscoveryPerRun,
      policy.maxItemsPerRun
    );

    this.log.info(`Executing pipeline for campaign "${campaign.name}" [${campaign.id}] (Target: ${campaign.city}, ${campaign.country} - ${campaign.niche}, Limit: ${maxItems})`);

    const discoveryProvider = options?.mock
      ? new MockBusinessDiscoveryProvider()
      : new WebSearchDiscoveryProvider();

    // 1. Discover
    const discoverySummary = await (discoveryProvider as any).discoverDetailed({
      niche: campaign.niche,
      city: campaign.city,
      country: campaign.country,
      state: campaign.state || undefined,
      limit: maxItems,
    });

    const discoveredItems = discoverySummary.results || [];
    let newBusinessesCount = 0;
    const businessIds: string[] = [];

    // 2. Persist & link to Campaign
    for (const item of discoveredItems) {
      const { business, isNew } = await this.businessRepo.upsertDiscoveredBusiness(
        item,
        item.reachability
      );
      if (isNew) newBusinessesCount++;
      businessIds.push(business.id);
    }

    // Assign businesses to this campaign
    await this.campaignRepo.assignBusinessesToCampaign(campaign.id, businessIds);

    // 3. Process each campaign business through the complete pipeline
    let auditedCount = 0;
    let leadsScoredCount = 0;
    let qualifiedCount = 0;
    let contactsFoundCount = 0;
    let draftsGeneratedCount = 0;
    let approvedCount = 0;
    let readyToSendCount = 0;
    let sentCount = 0;

    for (const businessId of businessIds) {
      const business = await this.db.business.findUnique({
        where: { id: businessId },
        include: {
          audits: { orderBy: { createdAt: 'desc' }, take: 1 },
          lead: { include: { outreach: true } },
          contacts: true,
        },
      });

      if (!business) continue;

      // A. Website Audit
      let auditResult = business.audits?.[0];
      if (!auditResult && business.website) {
        try {
          const audit = await this.auditService.auditBusinessById(business.id);
          if (audit) auditedCount++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log.warn(`Audit failed for "${business.name}": ${msg}`);
        }
      } else if (auditResult) {
        auditedCount++;
      }

      // B. Lead Scoring
      let lead = business.lead;
      if (!lead) {
        try {
          const scored = await this.scoringService.scoreBusinessById(business.id);
          leadsScoredCount++;
          if (scored.classification === 'HOT' || scored.classification === 'WARM') {
            qualifiedCount++;
          }
          // Fetch updated lead record
          lead = (await this.db.lead.findUnique({ where: { businessId: business.id }, include: { outreach: true } })) as any;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log.warn(`Scoring failed for "${business.name}": ${msg}`);
        }
      } else {
        leadsScoredCount++;
        if (lead.classification === 'HOT' || lead.classification === 'WARM') {
          qualifiedCount++;
        }
      }

      if (!lead) continue;

      // C. Contact Discovery
      try {
        const contactSummary = await this.contactService.discoverForBusiness(business.id);
        if (contactSummary.contacts.length > 0) {
          contactsFoundCount += contactSummary.contacts.length;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`Contact discovery failed for "${business.name}": ${msg}`);
      }

      // D. Personalization
      try {
        const result = await this.personalizationService.personalizeLead(lead.id);
        draftsGeneratedCount += result.variants.length;

        // Check Gate status on generated drafts
        const refreshedLead = await this.db.lead.findUnique({
          where: { id: lead.id },
          include: { outreach: true },
        });

        for (const draft of refreshedLead?.outreach || []) {
          const gateResult = await this.gateService.evaluateDraft(draft.id);
          if (gateResult.status === 'APPROVED') approvedCount++;
          if (gateResult.status === 'READY_TO_SEND') readyToSendCount++;
          if (gateResult.status === 'SENT') sentCount++;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`Personalization failed for "${business.name}": ${msg}`);
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      discovered: discoveredItems.length,
      newBusinesses: newBusinessesCount,
      audited: auditedCount,
      leadsScored: leadsScoredCount,
      qualifiedLeads: qualifiedCount,
      contactsFound: contactsFoundCount,
      draftsGenerated: draftsGeneratedCount,
      approvedCount,
      readyToSendCount,
      sentCount,
      durationMs,
    };
  }

  public async calculatePacing(campaignId: string): Promise<CampaignPacingSummary> {
    const campaign = await this.campaignRepo.getCampaignById(campaignId);
    if (!campaign) throw new Error(`Campaign "${campaignId}" not found`);

    const businesses = await this.campaignRepo.getCampaignBusinesses(campaignId);
    const achieved = businesses.filter((b) => {
      const lead = b.lead;
      return lead && (lead.leadOpportunityScore >= campaign.minLeadScore || lead.classification === 'HOT' || lead.classification === 'WARM');
    }).length;

    const targetTotal = campaign.targetBusinesses;
    const remaining = Math.max(0, targetTotal - achieved);

    // Calculate days since creation
    const now = new Date();
    const created = new Date(campaign.createdAt);
    const diffDays = Math.max(1, Math.ceil((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)));

    const currentAvgPerDay = parseFloat((achieved / diffDays).toFixed(1));
    const targetDaily = 5; // e.g. 5 qualified leads per day
    const avgPerDayRequired = parseFloat((remaining / Math.max(1, 14)).toFixed(1)); // 2-week target window

    let projectedCompletionDate: Date | null = null;
    if (currentAvgPerDay > 0 && remaining > 0) {
      const daysToComplete = Math.ceil(remaining / currentAvgPerDay);
      projectedCompletionDate = new Date(now.getTime() + daysToComplete * 24 * 60 * 60 * 1000);
    } else if (remaining === 0) {
      projectedCompletionDate = now;
    }

    return {
      targetTotal,
      achieved,
      remaining,
      avgPerDayRequired,
      currentAvgPerDay,
      projectedCompletionDate,
      onTrack: currentAvgPerDay >= avgPerDayRequired || remaining === 0,
    };
  }

  public async getCampaignReport(campaignId: string): Promise<CampaignReportResult> {
    const campaign = await this.campaignRepo.getCampaignById(campaignId);
    if (!campaign) throw new Error(`Campaign "${campaignId}" not found`);

    const funnel = await funnelAnalyticsService.getCampaignFunnel(campaignId);
    const pacing = await this.calculatePacing(campaignId);

    const businesses = await this.campaignRepo.getCampaignBusinesses(campaignId);

    let hot = 0;
    let warm = 0;
    let cold = 0;
    let disqualified = 0;

    const serviceBreakdown: Record<string, number> = {};
    const reviewStatus = {
      draft: 0,
      reviewRequired: 0,
      approved: 0,
      readyToSend: 0,
      sent: 0,
      rejected: 0,
      suppressed: 0,
    };

    for (const b of businesses) {
      const lead = b.lead;
      if (lead) {
        if (lead.classification === 'HOT') hot++;
        else if (lead.classification === 'WARM') warm++;
        else if (lead.classification === 'COLD') cold++;
        else if (lead.classification === 'DISQUALIFIED') disqualified++;

        const s = lead.recommendedService || 'WEBSITE_IMPROVEMENT';
        serviceBreakdown[s] = (serviceBreakdown[s] || 0) + 1;

        const outreaches = lead.outreach || [];
        for (const o of outreaches) {
          if (o.status === 'DRAFT') reviewStatus.draft++;
          else if (o.status === 'REVIEW_REQUIRED') reviewStatus.reviewRequired++;
          else if (o.status === 'APPROVED') reviewStatus.approved++;
          else if (o.status === 'READY_TO_SEND') reviewStatus.readyToSend++;
          else if (o.status === 'SENT') reviewStatus.sent++;
          else if (o.status === 'REJECTED') reviewStatus.rejected++;
          else if (o.status === 'SUPPRESSED') reviewStatus.suppressed++;
        }
      }
    }

    return {
      campaign,
      funnel,
      pacing,
      leadTemperatures: { hot, warm, cold, disqualified },
      serviceBreakdown,
      reviewStatus,
    };
  }
}

export const campaignService = new CampaignService();
