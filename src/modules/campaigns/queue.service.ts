import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';
import { LeadQueueItem, ReviewQueueItem, LeadClassification, AuditConfidence, RecommendedService, QualityBand, OutreachLifecycleStatus } from '../../types/index.js';

export interface LeadQueueFilters {
  country?: string;
  state?: string;
  city?: string;
  niche?: string;
  hotOnly?: boolean;
  phoneOnly?: boolean;
  minScore?: number;
  limit?: number;
}

export class QueueService {
  private db: PrismaClient;

  constructor(customDb?: PrismaClient) {
    this.db = customDb || getPrismaClient();
  }

  public async getLeadQueue(filters?: LeadQueueFilters): Promise<LeadQueueItem[]> {
    const where: any = {};

    if (filters?.minScore !== undefined) {
      where.leadOpportunityScore = { gte: filters.minScore };
    }

    if (filters?.hotOnly) {
      where.classification = 'HOT';
    }

    const businessWhere: any = {};
    if (filters?.country) {
      businessWhere.country = { contains: filters.country };
    }
    if (filters?.state) {
      businessWhere.city = { contains: filters.state };
    }
    if (filters?.city) {
      businessWhere.city = { contains: filters.city };
    }
    if (filters?.niche) {
      businessWhere.category = { contains: filters.niche };
    }

    if (Object.keys(businessWhere).length > 0) {
      where.business = businessWhere;
    }

    const leads = await this.db.lead.findMany({
      where,
      include: {
        business: {
          include: {
            audits: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            contacts: true,
          },
        },
      },
    });

    let items: LeadQueueItem[] = leads.map((l) => {
      const b = l.business;
      const audit = b?.audits?.[0];
      const primaryContact = b?.contacts?.[0];
      const hasWeb = Boolean(b?.website && b.website.trim().length > 0);
      const emailContact = b?.contacts?.find((c) => c.type === 'EMAIL');
      const formContact = b?.contacts?.find((c) => c.type === 'CONTACT_FORM');
      const phoneValue = b?.phone || b?.contacts?.find((c) => c.type === 'PHONE')?.value || primaryContact?.normalizedPhone || primaryContact?.rawPhone;

      let salesAngleText = 'Website improvement opportunity';
      if (l.salesAngle) {
        try {
          const parsed = JSON.parse(l.salesAngle);
          salesAngleText = parsed.problem || parsed.opportunity || parsed.reason || l.salesAngle;
        } catch {
          salesAngleText = l.salesAngle;
        }
      }

      let recommendedChannel: 'PHONE' | 'EMAIL' | 'CONTACT_FORM' = 'EMAIL';
      if (emailContact) {
        recommendedChannel = 'EMAIL';
      } else if (formContact) {
        recommendedChannel = 'CONTACT_FORM';
      } else if (phoneValue || !hasWeb) {
        recommendedChannel = 'PHONE';
      }

      return {
        id: l.id,
        businessId: l.businessId,
        businessName: b?.name || 'Unknown Business',
        city: b?.city || 'Unknown',
        state: b?.city || undefined,
        country: b?.country || 'US',
        address: b?.address || undefined,
        phone: phoneValue || undefined,
        niche: b?.category || 'General',
        website: b?.website || undefined,
        leadScore: l.leadOpportunityScore,
        classification: (l.classification as LeadClassification) || 'WARM',
        priorityRank: l.priorityRank,
        contactValue: l.primaryContactValue || primaryContact?.value || phoneValue || undefined,
        contactType: l.primaryContactType || primaryContact?.type || (phoneValue ? 'PHONE' : 'NONE'),
        contactQualityScore: l.contactQualityScore || primaryContact?.qualityScore || 0,
        problemSeverity: l.websiteProblemScore || 0,
        dataConfidence: (l.confidenceLevel as AuditConfidence) || 'MEDIUM',
        recommendedService: (l.recommendedService as RecommendedService) || 'WEBSITE_IMPROVEMENT',
        salesAngleText,
        recommendedChannel,
        status: l.status,
      };
    });

    if (filters?.phoneOnly) {
      items = items.filter((item) => Boolean(item.phone || item.contactType === 'PHONE' || item.recommendedChannel === 'PHONE'));
    }

    // Multi-factor sort: 1. Lead score (desc) -> 2. Contact quality (desc) -> 3. Problem severity (desc) -> 4. Priority rank (asc)
    items.sort((a, b) => {
      if (b.leadScore !== a.leadScore) return b.leadScore - a.leadScore;
      if (b.contactQualityScore !== a.contactQualityScore) return b.contactQualityScore - a.contactQualityScore;
      if (b.problemSeverity !== a.problemSeverity) return b.problemSeverity - a.problemSeverity;
      return a.priorityRank - b.priorityRank;
    });

    const limit = filters?.limit || 20;
    return items.slice(0, limit);
  }

  public async getReviewQueue(limit: number = 20): Promise<ReviewQueueItem[]> {
    const outreaches = await this.db.outreach.findMany({
      where: {
        status: { in: ['DRAFT', 'REVIEW_REQUIRED'] },
      },
      include: {
        lead: {
          include: {
            business: {
              include: {
                audits: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return outreaches.map((o) => {
      const lead = o.lead;
      const biz = lead?.business;
      const audit = biz?.audits?.[0];

      let salesAngleText = 'General outreach';
      if (o.salesAngle) {
        try {
          const parsed = JSON.parse(o.salesAngle);
          salesAngleText = parsed.reason || parsed.opportunity || o.salesAngle;
        } catch {
          salesAngleText = o.salesAngle;
        }
      }

      return {
        outreachId: o.id,
        leadId: o.leadId,
        businessId: biz?.id || 'unknown',
        businessName: biz?.name || 'Unknown',
        city: biz?.city || 'Unknown',
        website: biz?.website || undefined,
        leadScore: lead?.leadOpportunityScore || 0,
        classification: lead?.classification || 'WARM',
        websiteQualityScore: audit?.score || 0,
        contactValue: o.primaryContactValue || undefined,
        contactType: o.primaryContactType || 'EMAIL',
        salesAngle: salesAngleText,
        recommendedService: lead?.recommendedService || 'WEBSITE_IMPROVEMENT',
        subject: o.subject || 'No subject',
        bodyPreview: o.body.slice(0, 160) + (o.body.length > 160 ? '...' : ''),
        qualityScore: o.qualityScore,
        qualityBand: (o.qualityBand as QualityBand) || 'REVIEW_REQUIRED',
        evidenceValid: o.evidenceValid,
        identityValid: o.identityValid,
        isSuppressed: o.status === 'SUPPRESSED',
        isExpired: Boolean(o.expiresAt && o.expiresAt < new Date()),
        status: (o.status as OutreachLifecycleStatus) || 'DRAFT',
        approvedAt: o.approvedAt || undefined,
        approvedBy: o.approvedBy || undefined,
      };
    });
  }
}

export const queueService = new QueueService();
