import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';
import { MarketPerformanceMetric, ServiceDemandMetric, RecommendedService } from '../../types/index.js';

export class MarketIntelligenceService {
  private db: PrismaClient;

  constructor(customDb?: PrismaClient) {
    this.db = customDb || getPrismaClient();
  }

  public async getMarketPerformance(): Promise<MarketPerformanceMetric[]> {
    const businesses = await this.db.business.findMany({
      include: {
        lead: true,
        contacts: true,
      },
    });

    const map = new Map<string, {
      country: string;
      state?: string;
      city: string;
      niche: string;
      discovered: number;
      qualified: number;
      digitalContactable: number;
      phoneContactable: number;
      contactable: number;
      noContact: number;
      hot: number;
      warm: number;
      leadScoreSum: number;
      leadScoreCount: number;
      contactQualitySum: number;
      contactQualityCount: number;
      withWeb: number;
    }>();

    for (const b of businesses) {
      const key = `${b.country || 'US'}__${b.city || 'Unknown'}__${b.category || 'General'}`;
      if (!map.has(key)) {
        map.set(key, {
          country: b.country || 'US',
          city: b.city || 'Unknown',
          niche: b.category || 'General',
          discovered: 0,
          qualified: 0,
          digitalContactable: 0,
          phoneContactable: 0,
          contactable: 0,
          noContact: 0,
          hot: 0,
          warm: 0,
          leadScoreSum: 0,
          leadScoreCount: 0,
          contactQualitySum: 0,
          contactQualityCount: 0,
          withWeb: 0,
        });
      }

      const item = map.get(key)!;
      item.discovered++;
      if (b.website && b.website.trim().length > 0) item.withWeb++;

      const lead = b.lead;
      if (lead) {
        if (lead.classification === 'HOT' || lead.classification === 'WARM') {
          item.qualified++;
        }
        if (lead.classification === 'HOT') item.hot++;
        if (lead.classification === 'WARM') item.warm++;

        item.leadScoreSum += lead.leadOpportunityScore;
        item.leadScoreCount++;
      }

      const contacts = b.contacts || [];
      const hasEmail = contacts.some((c) => c.type === 'EMAIL' && Boolean(c.value));
      const hasForm = contacts.some((c) => c.type === 'CONTACT_FORM' && Boolean(c.value));
      const hasPhone = Boolean(b.phone) || contacts.some((c) => c.type === 'PHONE' && Boolean(c.value));

      if (hasEmail || hasForm) item.digitalContactable++;
      if (hasPhone) item.phoneContactable++;

      if (hasEmail || hasForm || hasPhone) {
        item.contactable++;
      } else {
        item.noContact++;
      }

      for (const c of contacts) {
        if (c.qualityScore > 0) {
          item.contactQualitySum += c.qualityScore;
          item.contactQualityCount++;
        }
      }
    }

    return Array.from(map.values()).map((v) => ({
      market: `${v.city}, ${v.country}`,
      country: v.country,
      city: v.city,
      niche: v.niche,
      discoveredTotal: v.discovered,
      qualifiedTotal: v.qualified,
      qualificationRate: v.discovered > 0 ? Math.round((v.qualified / v.discovered) * 100) : 0,
      digitalContactable: v.digitalContactable,
      digitalContactRate: v.discovered > 0 ? Math.round((v.digitalContactable / v.discovered) * 100) : 0,
      phoneContactable: v.phoneContactable,
      phoneContactRate: v.discovered > 0 ? Math.round((v.phoneContactable / v.discovered) * 100) : 0,
      contactableTotal: v.contactable,
      contactRate: v.discovered > 0 ? Math.round((v.contactable / v.discovered) * 100) : 0,
      noContactTotal: v.noContact,
      hotCount: v.hot,
      hotRate: v.discovered > 0 ? Math.round((v.hot / v.discovered) * 100) : 0,
      warmCount: v.warm,
      warmRate: v.discovered > 0 ? Math.round((v.warm / v.discovered) * 100) : 0,
      avgLeadScore: v.leadScoreCount > 0 ? Math.round(v.leadScoreSum / v.leadScoreCount) : 0,
      avgContactQuality: v.contactQualityCount > 0 ? Math.round(v.contactQualitySum / v.contactQualityCount) : 0,
      websiteAvailabilityRate: v.discovered > 0 ? Math.round((v.withWeb / v.discovered) * 100) : 0,
    }));
  }

  public async getServiceDemandBreakdown(): Promise<ServiceDemandMetric[]> {
    const leads = await this.db.lead.findMany({
      include: {
        business: {
          include: {
            contacts: true,
          },
        },
      },
    });

    const services: RecommendedService[] = [
      'WEBSITE_REBUILD',
      'WEBSITE_IMPROVEMENT',
      'MOBILE_OPTIMIZATION',
      'MOBILE_APP',
      'SEO_IMPROVEMENT',
      'MAINTENANCE',
      'NO_CLEAR_SERVICE_FIT',
    ];

    const map = new Map<RecommendedService, {
      leads: number;
      scoreSum: number;
      hot: number;
      warm: number;
      contactable: number;
    }>();

    for (const s of services) {
      map.set(s, { leads: 0, scoreSum: 0, hot: 0, warm: 0, contactable: 0 });
    }

    for (const lead of leads) {
      const rec = (lead.recommendedService as RecommendedService) || 'NO_CLEAR_SERVICE_FIT';
      if (!map.has(rec)) {
        map.set(rec, { leads: 0, scoreSum: 0, hot: 0, warm: 0, contactable: 0 });
      }

      const item = map.get(rec)!;
      item.leads++;
      item.scoreSum += lead.leadOpportunityScore;
      if (lead.classification === 'HOT') item.hot++;
      if (lead.classification === 'WARM') item.warm++;

      const contacts = lead.business?.contacts || [];
      const hasContact = contacts.length > 0 || Boolean(lead.business?.phone) || Boolean(lead.primaryContactValue);
      if (hasContact) item.contactable++;
    }

    return services.map((service) => {
      const data = map.get(service)!;
      return {
        service,
        leadCount: data.leads,
        avgLeadScore: data.leads > 0 ? Math.round(data.scoreSum / data.leads) : 0,
        hotCount: data.hot,
        warmCount: data.warm,
        contactableCount: data.contactable,
      };
    });
  }
}

export const marketIntelligenceService = new MarketIntelligenceService();
