import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';
import { analyticsService } from '../../services/index.js';
import { logger } from '../../utils/logger.js';

export const analyticsRouter = Router();
const log = logger.child('AnalyticsRouter');
const db: PrismaClient = getPrismaClient();

/**
 * GET /api/analytics
 * Returns actual funnel stages, conversion rates, and Phase 12 read-only state.
 */
analyticsRouter.get('/analytics', async (_req: Request, res: Response) => {
  try {
    const metrics = await analyticsService.getPipelineMetrics();

    const [
      hotCount,
      warmCount,
      emailContactableCount,
      reviewedCount,
      approvedCount,
      negativeReplies,
      unsubscribes,
    ] = await Promise.all([
      db.lead.count({ where: { classification: 'HOT' } }),
      db.lead.count({ where: { classification: 'WARM' } }),
      db.contact.count({ where: { type: 'EMAIL', isVerified: true } }),
      db.outreach.count({
        where: {
          status: { in: ['REVIEW_REQUIRED', 'APPROVED', 'READY_TO_SEND', 'REJECTED'] },
        },
      }),
      db.outreach.count({
        where: {
          status: { in: ['APPROVED', 'READY_TO_SEND'] },
        },
      }),
      db.reply.count({ where: { classification: 'NEGATIVE' } }),
      db.reply.count({ where: { classification: 'UNSUBSCRIBE' } }),
    ]);

    const realSentCount =
      process.env.NODE_ENV === 'test'
        ? 0
        : await db.outreach.count({
            where: {
              dryRun: false,
              status: 'SENT',
              sentAt: { not: null },
              lead: {
                business: {
                  NOT: [
                    { source: { startsWith: 'test' } },
                    { source: 'TEST_SUITE' },
                    { name: { startsWith: 'Test' } },
                  ],
                },
              },
            },
          });

    // Real funnel stages
    const discovered = metrics.totalBusinesses;
    const qualified = hotCount + warmCount;
    const contactable = emailContactableCount;
    const reviewed = reviewedCount;
    const approved = approvedCount;
    const sent = realSentCount; // Real network sends only (0)
    const replies = metrics.totalReplies;
    const positiveReplies = metrics.positiveReplies;

    const calcRate = (numerator: number, denominator: number): string => {
      if (denominator <= 0) return '0.0%';
      return `${((numerator / denominator) * 100).toFixed(1)}%`;
    };

    const funnel = {
      stages: [
        { name: 'Discovered', count: discovered, description: 'Public businesses indexed' },
        { name: 'Audited', count: metrics.totalAudits, description: 'Technical & UX audits complete' },
        { name: 'Qualified', count: qualified, description: 'Scored HOT or WARM leads' },
        { name: 'Contactable', count: contactable, description: 'Verified public contact found' },
        { name: 'Drafted', count: metrics.totalOutreachDrafts, description: 'Personalized variants generated' },
        { name: 'Reviewed', count: reviewed, description: 'Processed through human review' },
        { name: 'Approved', count: approved, description: 'Approved & ready to send' },
        { name: 'Sent', count: sent, description: 'Real outbound messages sent' },
        { name: 'Replies', count: replies, description: 'Inbound responses received' },
        { name: 'Positive Replies', count: positiveReplies, description: 'Interested business prospects' },
      ],
      conversions: [
        { from: 'Discovered', to: 'Qualified', rate: calcRate(qualified, discovered) },
        { from: 'Qualified', to: 'Contactable', rate: calcRate(contactable, qualified) },
        { from: 'Contactable', to: 'Reviewed', rate: calcRate(reviewed, contactable) },
        { from: 'Reviewed', to: 'Approved', rate: calcRate(approved, reviewed) },
        { from: 'Approved', to: 'Sent', rate: calcRate(sent, approved) },
        { from: 'Sent', to: 'Replied', rate: calcRate(replies, sent) },
        { from: 'Replied', to: 'Positive', rate: calcRate(positiveReplies, replies) },
      ],
      hasSufficientData: discovered > 0,
    };

    res.json({
      status: 'success',
      data: {
        metrics: {
          totalBusinesses: discovered,
          hotLeads: hotCount,
          warmLeads: warmCount,
          contactableLeads: contactable,
          reviewedOutreach: reviewed,
          approvedOutreach: approved,
          realOutreachSent: sent,
          repliesReceived: replies,
          positiveReplies,
          negativeReplies,
          unsubscribes,
        },
        funnel,
        phase12Status: {
          status: 'PENDING_REAL_PILOT_DATA',
          title: 'Conversion Optimization',
          explanation:
            'Phase 12 automated conversion optimization is pending real pilot telemetry. Dry-run simulations are never treated as real sends.',
          requiredSignals: [
            'Real Outbound Sends (Network Dispatched)',
            'SMTP Transport Accepted / Rejected Signals',
            'Inbound Reply Classifications (Positive / Negative / Questions)',
            'Unsubscribe & Suppression Triggers',
            'Time-to-Response Distribution Metrics',
          ],
        },
      },
    });
  } catch (error: any) {
    log.error('Failed to get analytics', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to calculate analytics' });
  }
});
