import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';
import {
  campaignService,
  campaignRunService,
  activityLogService,
} from '../../services/index.js';
import { logger } from '../../utils/logger.js';
import { SmtpDeliveryProvider } from '../../modules/outreach/execution/smtp-delivery.provider.js';

export const campaignsRouter = Router();
const log = logger.child('CampaignsRouter');
const db: PrismaClient = getPrismaClient();
const smtpProvider = new SmtpDeliveryProvider();

/**
 * GET /api/campaigns
 * Lists all campaigns enriched with real database metric counts and latest run state.
 */
campaignsRouter.get('/campaigns', async (_req: Request, res: Response) => {
  try {
    const allCampaigns = await campaignService.listCampaigns();
    const rawCampaigns = allCampaigns.slice(0, 50);

    const enriched = await Promise.all(
      rawCampaigns.map(async (c) => {
        const latestRun = await campaignRunService.getLatestRun(c.id);

        return {
          id: c.id,
          name: c.name,
          country: c.country,
          state: c.state || '',
          city: c.city,
          niche: c.niche,
          targetBusinesses: c.targetBusinesses,
          minLeadScore: c.minLeadScore,
          allowedLeadClasses: ['HOT', 'WARM'],
          preferredChannels: ['EMAIL', 'PHONE'],
          maxDiscoveryPerRun: c.maxDiscoveryPerRun,
          metrics: {
            discovered: latestRun?.discovered ?? 0,
            hot: latestRun?.hot ?? 0,
            warm: latestRun?.warm ?? 0,
            emailContactable: latestRun?.emailContactable ?? 0,
            phoneContactable: latestRun?.phoneContactable ?? 0,
            pendingReview: latestRun?.reviewRequired ?? 0,
            approved: latestRun?.approved ?? 0,
            sent: latestRun?.sent ?? 0,
            replies: latestRun?.replied ?? 0,
          },
          runState: latestRun?.status || 'CREATED',
          lastRunAt: latestRun?.startedAt || null,
          createdAt: c.createdAt,
        };
      })
    );

    res.json({
      status: 'success',
      data: enriched,
    });
  } catch (error: any) {
    log.error('Failed to list campaigns', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to list campaigns' });
  }
});

/**
 * POST /api/campaigns
 * Creates a new campaign with dual frontend/backend validation.
 */
campaignsRouter.post('/campaigns', async (req: Request, res: Response) => {
  try {
    const {
      name,
      country,
      state,
      city,
      niche,
      targetBusinesses,
      minScore,
      allowedLeadClasses,
      preferredChannels,
    } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ status: 'error', message: 'Campaign name is required' });
    }
    if (!city || typeof city !== 'string' || city.trim().length === 0) {
      return res.status(400).json({ status: 'error', message: 'City is required' });
    }
    if (!niche || typeof niche !== 'string' || niche.trim().length === 0) {
      return res.status(400).json({ status: 'error', message: 'Niche is required' });
    }

    const campaign = await campaignService.createCampaign({
      name: name.trim(),
      country: (country || 'US').trim().toUpperCase(),
      state: state ? state.trim() : undefined,
      city: city.trim(),
      niche: niche.trim(),
      targetBusinesses: Number(targetBusinesses) || 50,
      minLeadScore: Number(minScore) || 50,
      maxDiscoveryPerRun: Math.min(Number(targetBusinesses) || 50, 50),
    });

    await activityLogService.logEvent({
      eventType: 'CAMPAIGN_CREATED',
      entityType: 'CAMPAIGN',
      entityId: campaign.id,
      metadata: {
        campaignName: campaign.name,
        city: campaign.city,
        niche: campaign.niche,
        targetBusinesses: campaign.targetBusinesses,
      },
    });

    const policy = smtpProvider.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' });

    res.status(201).json({
      status: 'success',
      data: {
        campaign,
        safetyStatus: {
          dryRun: true,
          liveOutreachEnabled: false,
          killSwitchActive: true,
        },
        providerPolicy: {
          status: policy.status,
          reason: policy.reasonCode || policy.message,
          coldOutreachPermitted: false,
        },
      },
    });
  } catch (error: any) {
    log.error('Failed to create campaign', { error: error?.message });
    res.status(400).json({ status: 'error', message: error?.message || 'Failed to create campaign' });
  }
});

/**
 * GET /api/campaigns/:id
 * Fetches campaign detail, member stats, stage progress, errors, and activity history.
 */
campaignsRouter.get('/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    const campaign = await campaignService.getCampaign(campaignId);
    if (!campaign) {
      return res.status(404).json({ status: 'error', message: 'Campaign not found' });
    }

    const [latestRun, allRuns, membersCount, activity] = await Promise.all([
      campaignRunService.getLatestRun(campaignId),
      campaignRunService.listRuns(campaignId, 10),
      db.business.count({
        where: {
          OR: [{ campaignId }, { campaignBusinesses: { some: { campaignId } } }],
        },
      }),
      activityLogService.getRecentEvents(20, { entityType: 'CAMPAIGN' }),
    ]);

    res.json({
      status: 'success',
      data: {
        campaign,
        membersCount,
        latestRun,
        runs: allRuns,
        activity: activity.filter((a) => a.entityId === campaignId || !a.entityId),
      },
    });
  } catch (error: any) {
    log.error('Failed to get campaign detail', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to fetch campaign' });
  }
});

/**
 * POST /api/campaigns/:id/run
 * Executes campaign discovery and lead pipeline with live run tracking.
 */
campaignsRouter.post('/campaigns/:id/run', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    const campaign = await campaignService.getCampaign(campaignId);
    if (!campaign) {
      return res.status(404).json({ status: 'error', message: 'Campaign not found' });
    }

    const { maxItems, mock } = req.body || {};
    const target = Math.min(Number(maxItems) || campaign.maxDiscoveryPerRun || 10, 50);

    // Initialize run tracking record
    const run = await campaignRunService.startRun(campaignId, target);

    await activityLogService.logEvent({
      eventType: 'CAMPAIGN_STARTED',
      entityType: 'CAMPAIGN',
      entityId: campaignId,
      metadata: {
        runId: run.id,
        target,
        mock: Boolean(mock),
      },
    });

    // Run pipeline asynchronously so operator can track real progress
    (async () => {
      try {
        await campaignRunService.updateRunStage(run.id, 'DISCOVERING');
        const result = await campaignService.runCampaignPipeline(campaignId, {
          mock: Boolean(mock),
          maxItems: target,
        });

        await campaignRunService.recordProgress(run.id, {
          discovered: result.discovered,
          audited: result.audited,
          hot: result.qualifiedLeads,
          emailContactable: result.contactsFound,
          draftsGenerated: result.draftsGenerated,
          approved: result.approvedCount,
          sent: result.sentCount,
        });

        await campaignRunService.completeRun(run.id, 'COMPLETED');
      } catch (err: any) {
        log.error(`Campaign pipeline run failed for ${campaignId}`, { error: err?.message });
        await campaignRunService.completeRun(run.id, 'PARTIAL_FAILURE', err?.message);
      }
    })();

    res.json({
      status: 'success',
      data: {
        runId: run.id,
        status: run.status,
        target,
        message: 'Campaign run started. Progress is actively tracked in database.',
      },
    });
  } catch (error: any) {
    log.error('Failed to initiate campaign run', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to run campaign' });
  }
});

/**
 * GET /api/campaigns/:id/progress
 * Polls real persisted progress counts for active or latest campaign run.
 */
campaignsRouter.get('/campaigns/:id/progress', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    const run = await campaignRunService.getLatestRun(campaignId);

    if (!run) {
      return res.json({
        status: 'success',
        data: {
          hasRun: false,
          run: null,
        },
      });
    }

    res.json({
      status: 'success',
      data: {
        hasRun: true,
        run,
      },
    });
  } catch (error: any) {
    log.error('Failed to get campaign progress', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to fetch progress' });
  }
});
