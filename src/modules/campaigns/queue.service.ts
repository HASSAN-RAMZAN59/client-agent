import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';
import { LeadQueueItem, ReviewQueueItem, ReviewQueueFilters, LeadClassification, AuditConfidence, RecommendedService, QualityBand, OutreachLifecycleStatus } from '../../types/index.js';
import { normalizeNiche } from '../discovery/niche-normalizer.js';

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

      let suggestedObjective = 'Confirm whether the business currently has an official website and identify the person responsible for website/marketing decisions.';
      let suggestedOpening = `Hello, I was researching local ${b?.category || 'dental'} practices in ${b?.city || 'the area'} and wanted to check who manages your web presence and patient inquiries.`;

      if (hasWeb) {
        suggestedObjective = 'Connect with the practice manager to share a brief 2-minute overview of mobile layout refinements.';
        suggestedOpening = `Hi, I was looking over ${b?.name}'s website and had a quick observation regarding mobile visitor navigation for ${b?.city}.`;
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
        suggestedObjective,
        suggestedOpening,
        websiteStatus: hasWeb ? (audit?.status || 'AUDITED') : 'NO_WEBSITE',
        nameConfidence: 'HIGH',
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

  public async getReviewQueue(
    limit: number = 20,
    options?: ReviewQueueFilters | { includeTest?: boolean }
  ): Promise<ReviewQueueItem[]> {
    const filters: ReviewQueueFilters = options || {};
    const includeTest = filters.includeTest ?? false;
    const emailOnly = filters.emailOnly ?? (filters.pilotEligible ? true : false);
    const minClass = filters.minClass || (filters.pilotEligible ? 'HOT_OR_WARM' : 'ALL');

    // 1. Resolve Target Campaign if provided
    let campaign: any = null;
    if (filters.campaignId) {
      campaign = await this.db.campaign.findUnique({
        where: { id: filters.campaignId },
      });
    }

    const where: any = {
      status: { in: ['DRAFT', 'REVIEW_REQUIRED'] },
    };

    if (!includeTest) {
      where.lead = {
        business: {
          NOT: [
            { source: { startsWith: 'test' } },
            { source: 'TEST_SUITE' },
            { name: { startsWith: 'Test' } },
            { name: { startsWith: 'Execution Biz' } },
            { name: { startsWith: 'Contact Test' } },
            { name: { startsWith: 'BatchTest' } },
            { name: { startsWith: 'Phase11' } },
            { name: { startsWith: 'Approved Biz' } },
            { name: { startsWith: 'Cooldown Biz' } },
            { name: { startsWith: 'Suppressed' } },
            { name: { contains: 'Test Biz' } },
            { name: { contains: 'Personalize Test' } },
            { name: { contains: 'Expired Biz' } },
            { name: { contains: 'Suppressed Lead Biz' } },
            { name: { contains: 'Gate Biz' } },
            { name: { contains: 'Duplicate Biz' } },
            { name: { contains: 'Pilot Test' } },
            { name: { contains: 'Mock Biz' } },
            { name: { contains: 'Fixture Biz' } },
            { name: { contains: 'Test Clinic' } },
            { name: { contains: 'Scoring Test' } },
            { name: { contains: 'UnitTest' } },
          ],
        },
      };
    }

    const outreaches = await this.db.outreach.findMany({
      where,
      include: {
        lead: {
          include: {
            business: {
              include: {
                audits: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                },
                contacts: true,
                campaign: true,
                campaignBusinesses: { include: { campaign: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const items: ReviewQueueItem[] = [];

    for (const o of outreaches) {
      const lead = o.lead;
      const biz = lead?.business;
      const audit = biz?.audits?.[0];
      if (!lead || !biz) continue;

      // Campaign Filter
      if (campaign) {
        const matchesDirect = biz.campaignId === campaign.id;
        const matchesJoin = biz.campaignBusinesses?.some((cb: any) => cb.campaignId === campaign.id);
        if (!matchesDirect && !matchesJoin) continue;

        const isCityMatch = biz.city?.toLowerCase().trim() === campaign.city?.toLowerCase().trim();
        const isCountryMatch =
          biz.country?.toLowerCase().trim() === campaign.country?.toLowerCase().trim() ||
          (['us', 'usa', 'united states'].includes(biz.country?.toLowerCase().trim() || '') &&
            ['us', 'usa', 'united states'].includes(campaign.country?.toLowerCase().trim() || ''));
        if (!isCityMatch || !isCountryMatch) continue;

        const allowedNiches = campaign.niche
          ? campaign.niche.split(',').map((n: string) => n.trim()).filter(Boolean)
          : [];
        const isNicheMatch = allowedNiches.some((n: string) => {
          const targetNorm = normalizeNiche(n);
          const bizNorm = normalizeNiche(biz.category || '');
          if (targetNorm.isValid && bizNorm.isValid && targetNorm.canonical !== 'UNKNOWN' && targetNorm.canonical === bizNorm.canonical) {
            return true;
          }
          const lowerN = n.toLowerCase();
          const lowerCat = (biz.category || '').toLowerCase();
          if (lowerN === 'dentist' || lowerN === 'dental' || targetNorm.canonical === 'DENTIST') {
            return (
              lowerCat.includes('dent') ||
              lowerCat.includes('orthodont') ||
              lowerCat.includes('oral')
            );
          }
          if (lowerN === 'hvac' || lowerN === 'heating' || targetNorm.canonical === 'HVAC') {
            return (
              lowerCat.includes('hvac') ||
              lowerCat.includes('air condition') ||
              lowerCat.includes('heating') ||
              lowerCat.includes('heat')
            );
          }
          return lowerCat.includes(lowerN) || lowerN.includes(lowerCat);
        });
        if (!isNicheMatch) continue;
      }

      // Country Filter
      if (filters.country) {
        const isCountry =
          filters.country.toLowerCase() === 'us'
            ? ['us', 'usa', 'united states'].includes(biz.country?.toLowerCase().trim() || '')
            : biz.country?.toLowerCase().trim() === filters.country.toLowerCase().trim();
        if (!isCountry) continue;
      }

      // Quality Filter
      if (minClass === 'HOT_OR_WARM') {
        const lClass = (lead.classification || '').toUpperCase();
        if (lClass !== 'HOT' && lClass !== 'WARM') continue;
      }

      // Concrete Problem Check
      let topProblems: string[] = [];
      if (audit?.issuesJson) {
        try {
          topProblems = JSON.parse(audit.issuesJson);
        } catch {}
      }
      if (lead.topProblems) {
        try {
          const parsed = JSON.parse(lead.topProblems);
          if (Array.isArray(parsed) && parsed.length > 0) topProblems = parsed;
        } catch {}
      }
      const hasConcreteObservation =
        Boolean(audit?.loadTimeMs && audit.loadTimeMs > 0) ||
        Boolean(audit?.mobileResponsive === false) ||
        Boolean(audit?.sslValid === false) ||
        Boolean(audit?.hasContactForm === false) ||
        (Array.isArray(topProblems) && topProblems.length > 0);

      let salesAngleProblem = '';
      if (lead.salesAngle) {
        try {
          const parsed = JSON.parse(lead.salesAngle);
          salesAngleProblem = parsed.problem || '';
        } catch {}
      }
      const isGenericProblem =
        !salesAngleProblem ||
        salesAngleProblem.toLowerCase().includes('sub-optimal conversion flow') ||
        salesAngleProblem.toLowerCase().includes('modernization') ||
        salesAngleProblem.trim().length === 0;

      if (!hasConcreteObservation && isGenericProblem) {
        continue; // Missing concrete problem
      }

      // Business Name Safety Check
      const rawBizName = biz.name ? biz.name.trim() : '';
      const unsafeIdentityRegexes = [
        /^(?:dentist|dentists|dentistry|dental|hvac|plumber|plumbing|doctor|lawyer|attorney|roofing|electrician|cleaning)\s+in\s+[a-zA-Z\s,.-]+$/i,
        /^[a-zA-Z\s,.-]+,\s*(?:TX|CA|NY|FL|IL|PA|OH|GA|NC|MI|NJ|VA|WA|AZ|MA|TN|IN|MO|MD|WI|CO|MN|SC|AL|LA|KY|OR|OK|CT|UT|IA|NV|AR|MS|KS|NM|NE|ID|WV|HI|NH|ME|MT|RI|DE|SD|ND|AK|DC|USA)\s+(?:dentists?|dentistry|hvac|plumbers?|doctors?|lawyers?|attorneys?|services)$/i,
        /^(?:dentist|dentistry|dental|hvac|plumber|doctor|lawyer)\s+near\s+me$/i,
        /^(?:best|top|affordable|emergency|cheap)\s+(?:dentists?|hvac|plumbers?|doctors?)\s+in\s+[a-zA-Z\s,.-]+$/i,
      ];
      if (!rawBizName || rawBizName.length < 2 || unsafeIdentityRegexes.some((rx) => rx.test(rawBizName))) {
        continue; // BUSINESS_IDENTITY_UNSAFE
      }

      // Channel / Email Check
      const emailContact = biz.contacts?.find((ct: any) => ct.type === 'EMAIL' && ct.status === 'VERIFIED_PUBLIC' && ct.sourceUrl);
      if (emailOnly) {
        if (o.channel !== 'EMAIL') continue;
        if (!o.primaryContactValue && !emailContact) continue;
        if (o.primaryContactValue && !o.primaryContactValue.includes('@')) continue;
      }

      let salesAngleText = 'General outreach';
      if (o.salesAngle) {
        try {
          const parsed = JSON.parse(o.salesAngle);
          salesAngleText = parsed.reason || parsed.opportunity || o.salesAngle;
        } catch {
          salesAngleText = o.salesAngle;
        }
      }

      items.push({
        outreachId: o.id,
        leadId: o.leadId,
        businessId: biz.id,
        businessName: biz.name,
        city: biz.city || 'Unknown',
        website: biz.website || undefined,
        leadScore: lead.leadOpportunityScore || 0,
        classification: lead.classification || 'WARM',
        websiteQualityScore: audit?.score || 0,
        contactValue: o.primaryContactValue || emailContact?.value || undefined,
        contactType: o.primaryContactType || 'EMAIL',
        salesAngle: salesAngleText,
        recommendedService: lead.recommendedService || 'WEBSITE_IMPROVEMENT',
        subject: o.subject || 'No subject',
        bodyPreview: o.body.slice(0, 160) + (o.body.length > 160 ? '...' : ''),
        qualityScore: o.qualityScore,
        qualityBand: (o.qualityBand as QualityBand) || 'REVIEW_REQUIRED',
        evidenceValid: o.evidenceValid,
        identityValid: o.identityValid,
        isSuppressed: o.status === 'SUPPRESSED',
        status: (o.status as OutreachLifecycleStatus) || 'DRAFT',
        approvedAt: o.approvedAt || undefined,
        approvedBy: o.approvedBy || undefined,
      });
    }

    // Sort: 1. HOT > WARM > COLD, 2. Score desc
    items.sort((a, b) => {
      const classWeight = (c: string) => (c === 'HOT' ? 3 : c === 'WARM' ? 2 : 1);
      if (classWeight(b.classification) !== classWeight(a.classification)) {
        return classWeight(b.classification) - classWeight(a.classification);
      }
      return b.leadScore - a.leadScore;
    });

    return items.slice(0, limit);
  }
}

export const queueService = new QueueService();

