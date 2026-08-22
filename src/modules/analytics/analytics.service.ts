import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';
import { PipelineMetrics } from './analytics.interface.js';
import { logger } from '../../utils/logger.js';

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
      this.db.business.count(),
      this.db.websiteAudit.count(),
      this.db.lead.count(),
      this.db.lead.count({ where: { status: 'QUALIFIED' } }),
      this.db.lead.count({ where: { status: 'DISQUALIFIED' } }),
      this.db.contact.count(),
      this.db.outreach.count({ where: { status: 'DRAFT' } }),
      this.db.outreach.count({ where: { status: 'SENT' } }),
      this.db.followUp.count(),
      this.db.reply.count(),
      this.db.reply.count({ where: { classification: 'POSITIVE_INTEREST' } }),
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
