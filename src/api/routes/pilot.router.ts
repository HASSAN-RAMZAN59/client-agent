import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';
import { PilotExecutionService } from '../../modules/outreach/execution/pilot-execution.service.js';
import { SmtpDeliveryProvider } from '../../modules/outreach/execution/smtp-delivery.provider.js';
import { activityLogService } from '../../services/index.js';
import { TEST_BUSINESS_FILTER } from '../../database/test-exclusion.js';
import { logger } from '../../utils/logger.js';

export const pilotRouter = Router();
const log = logger.child('PilotRouter');
const db: PrismaClient = getPrismaClient();
const pilotService = new PilotExecutionService();
const smtpProvider = new SmtpDeliveryProvider();

/**
 * GET /api/pilot/candidates
 * Fetches approved pilot candidates including Chapman Air & Heat and Dallas Dental Specialists.
 * Supports optional ?campaignId=<id> or ?campaign=<id> for campaign-scoped candidate views.
 */
pilotRouter.get('/pilot/candidates', async (req: Request, res: Response) => {
  try {
    const rawCampaignId = (req.query.campaignId || req.query.campaign) as string | undefined;
    const campaignId = rawCampaignId ? rawCampaignId.trim() : '';

    const businessWhere: any = {
      ...TEST_BUSINESS_FILTER,
    };

    if (campaignId) {
      businessWhere.OR = [
        { campaignId },
        { campaignBusinesses: { some: { campaignId } } },
      ];
    }

    const drafts = await db.outreach.findMany({
      where: {
        status: { in: ['APPROVED', 'READY_TO_SEND'] },
        lead: {
          business: businessWhere,
        },
      },
      include: {
        lead: {
          include: {
            business: {
              include: {
                contacts: true,
                campaign: true,
              },
            },
          },
        },
      },
      orderBy: { approvedAt: 'desc' },
    });

    const policy = smtpProvider.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' });

    const candidates = await Promise.all(
      drafts.map(async (d) => {
        const b = d.lead.business;
        const contact = b.contacts.find((c) => c.type === 'EMAIL' && c.isVerified);

        const suppression = await db.suppression.findFirst({
          where: {
            OR: [
              { businessId: b.id },
              { targetValue: contact?.value || d.primaryContactValue || '' },
            ],
          },
        });

        return {
          outreachId: d.id,
          businessId: b.id,
          businessName: b.name,
          city: b.city,
          country: b.country,
          niche: b.category,
          website: b.website,
          recipientEmail: contact?.value || d.primaryContactValue || 'N/A',
          isVerifiedPublic: Boolean(contact?.isVerified),
          exactSourceUrl: contact?.sourceUrl || null,
          leadScore: d.lead.leadOpportunityScore,
          leadClass: d.lead.classification,
          variant: d.variant,
          subject: d.finalSubject || d.subject,
          body: d.finalBody || d.body,
          status: d.status,
          approvalStatus: d.approvalStatus,
          approvedAt: d.approvedAt,
          approvedBy: d.approvedBy,
          contentHash: d.contentHash,
          isSuppressed: Boolean(suppression),
          cooldownActive: false,
          sentAt: d.sentAt,
          providerPolicy: policy.status,
          liveEligibility: policy.status === 'PERMITTED' ? 'ELIGIBLE' : 'PROVIDER_BLOCKED',
        };
      })
    );

    res.json({
      status: 'success',
      data: {
        total: candidates.length,
        candidates,
        providerPolicy: {
          status: policy.status,
          reason: policy.reasonCode || policy.message,
          coldOutreachPermitted: policy.status === 'PERMITTED',
        },
      },
    });
  } catch (error: any) {
    log.error('Failed to get pilot candidates', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to get pilot candidates' });
  }
});

/**
 * GET /api/pilot/preview
 * Executes pre-send validation check.
 * Strictly sends ZERO network messages.
 */
pilotRouter.get('/pilot/preview', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(10, Math.max(1, parseInt(req.query.limit as string, 10) || 3));
    const campaignId = req.query.campaignId as string | undefined;
    const pilotCountry = (req.query.country as string) || 'US';

    const preview = await pilotService.previewPilot(limit, campaignId, {
      pilotCountry,
      includeTest: false,
    });

    res.json({
      status: 'success',
      data: preview,
    });
  } catch (error: any) {
    log.error('Failed to execute pilot preview', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to run pilot preview' });
  }
});

/**
 * POST /api/pilot/dry-run
 * Executes safe mock dry-run simulation.
 * Network sends: 0, Real emails sent: 0.
 */
pilotRouter.post('/pilot/dry-run', async (req: Request, res: Response) => {
  try {
    const { campaignId, limit } = req.body || {};
    const parsedLimit = Math.min(5, Math.max(1, parseInt(limit, 10) || 2));

    const result = await pilotService.executePilot({
      dryRun: true,
      confirm: true,
      limit: parsedLimit,
      campaignId: campaignId || undefined,
      includeTest: false,
    });

    await activityLogService.logEvent({
      eventType: 'DRY_RUN_EXECUTED',
      entityType: 'OUTREACH',
      metadata: {
        simulatedCount: result.simulated,
        networkSends: 0,
        realEmailsSent: 0,
        campaignId: campaignId || null,
      },
    });

    res.json({
      status: 'success',
      data: {
        ...result,
        networkSends: 0,
        realEmailsSent: 0,
        simulationSummary: {
          isSimulation: true,
          candidatesEligible: result.totalEligible,
          simulatedSends: result.simulated,
          blockedSends: result.blocked,
          failedSends: result.failed,
          realNetworkSends: 0,
          realEmailsSent: 0,
        },
      },
    });
  } catch (error: any) {
    log.error('Failed to execute dry-run simulation', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to execute dry-run' });
  }
});

/**
 * POST /api/pilot/live-send
 * Authoritative backend gate: Live cold outreach is strictly blocked when provider policy is UNSUPPORTED.
 */
pilotRouter.post('/pilot/live-send', async (_req: Request, res: Response) => {
  const policy = smtpProvider.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' });

  await activityLogService.logEvent({
    eventType: 'PROVIDER_POLICY_BLOCKED',
    entityType: 'SYSTEM',
    metadata: {
      provider: 'GMAIL_SMTP',
      policyStatus: policy.status,
      reason: policy.reasonCode || policy.message,
      attemptedAction: 'LIVE_COLD_OUTREACH',
    },
  });

  return res.status(403).json({
    status: 'blocked',
    error: 'OUTBOUND_PROVIDER_POLICY_UNSUPPORTED',
    message: 'LIVE SEND BLOCKED: Personal Gmail is not approved for cold commercial outreach.',
    providerPolicy: {
      configured: true,
      networkCapable: true,
      coldOutreachPermitted: false,
      status: policy.status,
      reason: policy.reasonCode || policy.message,
    },
  });
});
