import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';
import { CampaignFunnelStage, CampaignFunnelSummary } from '../../types/index.js';

export class FunnelAnalyticsService {
  private db: PrismaClient;

  constructor(customDb?: PrismaClient) {
    this.db = customDb || getPrismaClient();
  }

  public async getCampaignFunnel(campaignId: string): Promise<CampaignFunnelSummary> {
    const campaign = await this.db.campaign.findUnique({
      where: { id: campaignId },
      include: {
        businesses: {
          include: {
            audits: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            lead: {
              include: {
                outreach: true,
              },
            },
            contacts: true,
          },
        },
      },
    });

    if (!campaign) {
      throw new Error(`Campaign with ID "${campaignId}" not found`);
    }

    const businesses = campaign.businesses || [];
    const rawDiscovered = businesses.length;
    const uniqueBusinesses = businesses.length; // In SQLite, businesses table is already deduplicated

    let websiteAvailable = 0;
    let auditable = 0;
    let qualified = 0;
    let contactable = 0;
    let digitalContactable = 0;
    let emailCount = 0;
    let formCount = 0;
    let phoneContactable = 0;
    let businessPhoneCount = 0;
    let noContact = 0;
    let personalized = 0;
    let reviewed = 0;
    let approved = 0;
    let readyToSend = 0;
    let sent = 0;

    for (const b of businesses) {
      const hasWeb = Boolean(b.website && b.website.trim().length > 0);
      if (hasWeb) websiteAvailable++;

      const latestAudit = b.audits?.[0];
      if (latestAudit && latestAudit.status !== 'ERROR' && latestAudit.status !== 'PENDING') {
        auditable++;
      }

      const contacts = b.contacts || [];
      const hasEmail = contacts.some((c) => c.type === 'EMAIL' && Boolean(c.value));
      const hasForm = contacts.some((c) => c.type === 'CONTACT_FORM' && Boolean(c.value));
      const hasPhone = Boolean(b.phone) || contacts.some((c) => c.type === 'PHONE' && Boolean(c.value));

      if (hasEmail) emailCount++;
      if (hasForm) formCount++;
      if (hasEmail || hasForm) digitalContactable++;
      if (hasPhone) {
        phoneContactable++;
        businessPhoneCount++;
      }

      const hasAnyContact = hasEmail || hasForm || hasPhone;
      if (hasAnyContact) {
        contactable++;
      } else {
        noContact++;
      }

      const lead = b.lead;
      if (lead) {
        // Qualified if score meets campaign minimum or is HOT/WARM
        const isQual = lead.leadOpportunityScore >= campaign.minLeadScore || lead.classification === 'HOT' || lead.classification === 'WARM';
        if (isQual) qualified++;

        const outreaches = lead.outreach || [];
        if (outreaches.length > 0) personalized++;

        const hasReviewed = outreaches.some((o) => o.status !== 'DRAFT');
        if (hasReviewed) reviewed++;

        const hasApproved = outreaches.some((o) => Boolean(o.approvedAt) || o.status === 'APPROVED' || o.status === 'READY_TO_SEND' || o.status === 'SENT');
        if (hasApproved) approved++;

        const hasReady = outreaches.some((o) => o.status === 'READY_TO_SEND' || o.status === 'SENT');
        if (hasReady) readyToSend++;

        const hasSent = outreaches.some((o) => o.status === 'SENT');
        if (hasSent) sent++;
      }
    }

    const rawCounts = [
      { name: 'RAW DISCOVERED', count: rawDiscovered },
      { name: 'UNIQUE BUSINESSES', count: uniqueBusinesses },
      { name: 'WEBSITE AVAILABLE', count: websiteAvailable },
      { name: 'AUDITABLE', count: auditable },
      { name: 'QUALIFIED', count: qualified },
      { name: 'CONTACTABLE', count: contactable },
      { name: 'PERSONALIZED', count: personalized },
      { name: 'REVIEWED', count: reviewed },
      { name: 'APPROVED', count: approved },
      { name: 'READY TO SEND', count: readyToSend },
      { name: 'SENT', count: sent },
    ];

    const stages: CampaignFunnelStage[] = [];
    let maxDropOffCount = -1;
    let bottleneckStage = 'DISCOVERY';
    let bottleneckReason = 'No drop-offs detected';

    for (let i = 0; i < rawCounts.length; i++) {
      const current = rawCounts[i]!;
      const prev = i > 0 ? rawCounts[i - 1]! : null;

      const percentage = rawDiscovered > 0 ? Math.round((current.count / rawDiscovered) * 100) : 0;
      const conversionFromPrevious = prev && prev.count > 0 ? Math.round((current.count / prev.count) * 100) : (i === 0 ? 100 : 0);
      const dropOffCount = prev ? Math.max(0, prev.count - current.count) : 0;
      const dropOffPercentage = prev && prev.count > 0 ? Math.round((dropOffCount / prev.count) * 100) : 0;

      if (prev && dropOffCount > maxDropOffCount) {
        maxDropOffCount = dropOffCount;
        bottleneckStage = `${prev.name} -> ${current.name}`;
        bottleneckReason = `Lost ${dropOffCount} prospects (${dropOffPercentage}% drop-off) between ${prev.name} and ${current.name}.`;
      }

      stages.push({
        stage: current.name,
        count: current.count,
        percentage,
        conversionFromPrevious,
        dropOffCount,
        dropOffPercentage,
      });
    }

    const contactability = {
      digitalContactable,
      digitalContactRate: rawDiscovered > 0 ? Math.round((digitalContactable / rawDiscovered) * 100) : 0,
      emailCount,
      formCount,
      phoneContactable,
      phoneContactRate: rawDiscovered > 0 ? Math.round((phoneContactable / rawDiscovered) * 100) : 0,
      businessPhoneCount,
      totalContactable: contactable,
      totalContactRate: rawDiscovered > 0 ? Math.round((contactable / rawDiscovered) * 100) : 0,
      noContact,
      noContactRate: rawDiscovered > 0 ? Math.round((noContact / rawDiscovered) * 100) : 0,
    };

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      stages,
      contactability,
      bottleneckStage,
      bottleneckReason: maxDropOffCount > 0 ? bottleneckReason : 'Pipeline converting smoothly without major bottlenecks.',
    };
  }
}

export const funnelAnalyticsService = new FunnelAnalyticsService();
