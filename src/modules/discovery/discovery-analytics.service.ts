import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';

export interface DiscoveryStatsFilter {
  country?: string;
  city?: string;
  niche?: string;
}

export interface MarketYieldMetric {
  market: string;
  niche: string;
  totalDiscovered: number;
  withWebsite: number;
  noWebsite: number;
  phoneAvailable: number;
  emailsFound: number;
  hotLeads: number;
  warmLeads: number;
  coldLeads: number;
  websiteRate: number;
  contactabilityRate: number;
  qualificationRate: number;
}

export interface OverallDiscoveryStats {
  totalDiscovered: number;
  withWebsite: number;
  noWebsite: number;
  websiteAvailabilityRate: number;
  totalLeadsScored: number;
  hotLeads: number;
  warmLeads: number;
  coldLeads: number;
  disqualifiedLeads: number;
  qualificationRate: number;
  totalContactsDiscovered: number;
  emailContacts: number;
  phoneContacts: number;
  formContacts: number;
  contactAvailabilityRate: number;
  marketBreakdown: MarketYieldMetric[];
}

export class DiscoveryAnalyticsService {
  private db: PrismaClient;

  constructor(customDb?: PrismaClient) {
    this.db = customDb || getPrismaClient();
  }

  public async getDiscoveryStats(filter?: DiscoveryStatsFilter): Promise<OverallDiscoveryStats> {
    const whereClause: any = {};
    if (filter?.country) {
      whereClause.country = { contains: filter.country };
    }
    if (filter?.city) {
      whereClause.city = { contains: filter.city };
    }
    if (filter?.niche) {
      whereClause.category = { contains: filter.niche };
    }

    const businesses = await this.db.business.findMany({
      where: whereClause,
      include: {
        lead: true,
        contacts: true,
        audits: true,
      },
    });

    const totalDiscovered = businesses.length;
    let withWebsite = 0;
    let noWebsite = 0;
    let totalLeadsScored = 0;
    let hotLeads = 0;
    let warmLeads = 0;
    let coldLeads = 0;
    let disqualifiedLeads = 0;

    let emailContacts = 0;
    let phoneContacts = 0;
    let formContacts = 0;
    let businessesWithContact = 0;

    // Grouping by market + niche
    const marketGroups = new Map<string, {
      market: string;
      niche: string;
      total: number;
      withWeb: number;
      noWeb: number;
      phones: number;
      emails: number;
      hot: number;
      warm: number;
      cold: number;
      contactable: number;
    }>();

    for (const b of businesses) {
      const hasWeb = Boolean(b.website && b.website.trim().length > 0);
      if (hasWeb) withWebsite++;
      else noWebsite++;

      const lead = b.lead;
      if (lead) {
        totalLeadsScored++;
        if (lead.classification === 'HOT') hotLeads++;
        else if (lead.classification === 'WARM') warmLeads++;
        else if (lead.classification === 'COLD') coldLeads++;
        else if (lead.classification === 'DISQUALIFIED') disqualifiedLeads++;
      }

      const contacts = b.contacts || [];
      const hasEmail = contacts.some((c) => c.type === 'EMAIL');
      const hasPhone = contacts.some((c) => c.type === 'PHONE') || Boolean(b.phone);
      const hasForm = contacts.some((c) => c.type === 'CONTACT_FORM');

      if (hasEmail) emailContacts++;
      if (hasPhone) phoneContacts++;
      if (hasForm) formContacts++;
      if (hasEmail || hasPhone || hasForm) businessesWithContact++;

      // Market group key
      const marketKey = `${b.city || 'Unknown'}, ${b.country || 'Global'}__${b.category || 'General'}`;
      if (!marketGroups.has(marketKey)) {
        marketGroups.set(marketKey, {
          market: `${b.city || 'Unknown'}, ${b.country || 'Global'}`,
          niche: b.category || 'General',
          total: 0,
          withWeb: 0,
          noWeb: 0,
          phones: 0,
          emails: 0,
          hot: 0,
          warm: 0,
          cold: 0,
          contactable: 0,
        });
      }

      const group = marketGroups.get(marketKey)!;
      group.total++;
      if (hasWeb) group.withWeb++;
      else group.noWeb++;
      if (hasPhone) group.phones++;
      if (hasEmail) group.emails++;
      if (lead?.classification === 'HOT') group.hot++;
      else if (lead?.classification === 'WARM') group.warm++;
      else if (lead?.classification === 'COLD' || lead?.classification === 'DISQUALIFIED') group.cold++;
      if (hasEmail || hasPhone || hasForm) group.contactable++;
    }

    const marketBreakdown: MarketYieldMetric[] = Array.from(marketGroups.values()).map((g) => ({
      market: g.market,
      niche: g.niche,
      totalDiscovered: g.total,
      withWebsite: g.withWeb,
      noWebsite: g.noWeb,
      phoneAvailable: g.phones,
      emailsFound: g.emails,
      hotLeads: g.hot,
      warmLeads: g.warm,
      coldLeads: g.cold,
      websiteRate: g.total > 0 ? Math.round((g.withWeb / g.total) * 100) : 0,
      contactabilityRate: g.total > 0 ? Math.round((g.contactable / g.total) * 100) : 0,
      qualificationRate: g.total > 0 ? Math.round(((g.hot + g.warm) / g.total) * 100) : 0,
    }));

    return {
      totalDiscovered,
      withWebsite,
      noWebsite,
      websiteAvailabilityRate: totalDiscovered > 0 ? Math.round((withWebsite / totalDiscovered) * 100) : 0,
      totalLeadsScored,
      hotLeads,
      warmLeads,
      coldLeads,
      disqualifiedLeads,
      qualificationRate: totalLeadsScored > 0 ? Math.round(((hotLeads + warmLeads) / totalLeadsScored) * 100) : 0,
      totalContactsDiscovered: emailContacts + phoneContacts + formContacts,
      emailContacts,
      phoneContacts,
      formContacts,
      contactAvailabilityRate: totalDiscovered > 0 ? Math.round((businessesWithContact / totalDiscovered) * 100) : 0,
      marketBreakdown,
    };
  }
}

export const discoveryAnalyticsService = new DiscoveryAnalyticsService();
