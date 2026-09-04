import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';
import { PipelineMetrics } from './analytics.interface.js';
import { logger } from '../../utils/logger.js';
import { TEST_BUSINESS_FILTER } from '../../database/test-exclusion.js';

export class AnalyticsService {
  private db: PrismaClient;
  private log = logger.child('Analytics');

  constructor(client: PrismaClient = getPrismaClient()) {
    this.db = client;
  }

  public async getPipelineMetrics(): Promise<PipelineMetrics> {
    this.log.debug('Aggregating pipeline metrics across local SQLite database');

    const [
      totalBusinesses,
      totalAudits,
      totalLeads,
      qualifiedLeads,
      disqualifiedLeads,
      totalContacts,
      totalOutreachDrafts,
      totalOutreachSent,
      totalFollowUps,
      totalReplies,
      positiveReplies,
    ] = await Promise.all([
      this.db.business.count({ where: TEST_BUSINESS_FILTER }),
      this.db.websiteAudit.count({ where: { business: TEST_BUSINESS_FILTER } }),
      this.db.lead.count({ where: { business: TEST_BUSINESS_FILTER } }),
      this.db.lead.count({ where: { status: 'QUALIFIED', business: TEST_BUSINESS_FILTER } }),
      this.db.lead.count({ where: { status: 'DISQUALIFIED', business: TEST_BUSINESS_FILTER } }),
      this.db.contact.count({ where: { business: TEST_BUSINESS_FILTER } }),
      this.db.outreach.count({ where: { status: 'DRAFT', lead: { business: TEST_BUSINESS_FILTER } } }),
      process.env.NODE_ENV === 'test'
        ? 0
        : this.db.outreach.count({
            where: {
              status: 'SENT',
              dryRun: false,
              sentAt: { not: null },
              lead: { business: TEST_BUSINESS_FILTER },
            },
          }),
      this.db.followUp.count({ where: { outreach: { lead: { business: TEST_BUSINESS_FILTER } } } }),
      this.db.reply.count({ where: { outreach: { lead: { business: TEST_BUSINESS_FILTER } } } }),
      this.db.reply.count({
        where: {
          classification: 'POSITIVE',
          outreach: { lead: { business: TEST_BUSINESS_FILTER } },
        },
      }),
    ]);

    const opportunityRatePct =
      totalLeads > 0 ? Math.round((qualifiedLeads / totalLeads) * 100) : 0;

    return {
      totalBusinesses,
      totalAudits,
      totalLeads,
      qualifiedLeads,
      disqualifiedLeads,
      totalContacts,
      totalOutreachDrafts,
      totalOutreachSent,
      totalFollowUps,
      totalReplies,
      positiveReplies,
      opportunityRatePct,
    };
  }
}

export const analyticsService = new AnalyticsService();
