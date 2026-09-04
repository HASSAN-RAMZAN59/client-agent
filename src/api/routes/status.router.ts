import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';
import { systemStatusService, HealthService, interactiveReviewerService } from '../../services/index.js';
import { TEST_BUSINESS_FILTER } from '../../database/test-exclusion.js';
import { logger } from '../../utils/logger.js';

export const statusRouter = Router();
const log = logger.child('StatusRouter');
const db: PrismaClient = getPrismaClient();

/**
 * GET /api/navigation-summary
 * Returns campaign-scoped navigation counts (pendingReview, readyToSend).
 * When campaignId is provided:
 * - pendingReview: authoritative count of unique businesses awaiting review (reuses interactiveReviewerService)
 * - readyToSend: authoritative count of approved / ready-to-send businesses for the campaign
 * When campaignId is omitted or empty:
 * - pendingReview: global pending review count
 * - readyToSend: global approved / ready-to-send count
 */
statusRouter.get('/navigation-summary', async (req: Request, res: Response) => {
  try {
    const rawCampaignId = (req.query.campaignId || req.query.campaign) as string | undefined;
    const campaignId = rawCampaignId ? rawCampaignId.trim() : '';

    let pendingReview = 0;
    let readyToSend = 0;

    if (campaignId) {
      // 1. Authoritative review items count using exact same service as Review Queue page
      const groups = await interactiveReviewerService.getPendingBusinessGroups({
        campaignId,
        includeTest: false,
        limit: 1000,
      });
      pendingReview = groups.length;

      // 2. Authoritative approved & ready to send count for this campaign
      readyToSend = await db.business.count({
        where: {
          ...TEST_BUSINESS_FILTER,
          OR: [
            { campaignId },
            { campaignBusinesses: { some: { campaignId } } },
          ],
          lead: {
            outreach: {
              some: {
                status: { in: ['APPROVED', 'READY_TO_SEND'] },
              },
            },
          },
        },
      });
    } else {
      // Global counts
      const summary = await systemStatusService.getStatusSummary();
      pendingReview = summary.counts.pendingReview;
      readyToSend = summary.counts.approved;
    }

    res.json({
      status: 'success',
      data: {
        campaignId: campaignId || null,
        isScoped: Boolean(campaignId),
        pendingReview,
        readyToSend,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    log.error('Failed to get navigation summary', { error: error?.message });
    res.status(500).json({
      status: 'error',
      message: error?.message || 'Internal navigation summary error',
    });
  }
});

/**
 * GET /api/status
 * Returns operational summary: database size, counts, provider status, safety flags, and latest run.
 * Supports optional ?campaign=<id> or ?campaignId=<id> to scope pendingReview and readyToSend counts.
 */
statusRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const summary = await systemStatusService.getStatusSummary();
    const rawCampaignId = (req.query.campaignId || req.query.campaign) as string | undefined;
    const campaignId = rawCampaignId ? rawCampaignId.trim() : '';

    if (campaignId) {
      const groups = await interactiveReviewerService.getPendingBusinessGroups({
        campaignId,
        includeTest: false,
        limit: 1000,
      });
      summary.counts.pendingReview = groups.length;

      summary.counts.readyToSend = await db.business.count({
        where: {
          ...TEST_BUSINESS_FILTER,
          OR: [
            { campaignId },
            { campaignBusinesses: { some: { campaignId } } },
          ],
          lead: {
            outreach: {
              some: {
                status: { in: ['APPROVED', 'READY_TO_SEND'] },
              },
            },
          },
        },
      });
    }

    res.json({
      status: 'success',
      data: summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    log.error('Failed to get status summary', { error: error?.message });
    res.status(500).json({
      status: 'error',
      message: error?.message || 'Internal status error',
    });
  }
});

/**
 * GET /api/health
 * Returns granular component health (Prisma, SQLite, Playwright, SMTP, Discovery, Policy; 0 sends).
 */
statusRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const health = await HealthService.getStatus();
    res.json({
      status: 'success',
      data: health,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    log.error('Failed to get health status', { error: error?.message });
    res.status(500).json({
      status: 'error',
      message: error?.message || 'Internal health error',
    });
  }
});
