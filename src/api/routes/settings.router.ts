import { Router, Request, Response } from 'express';
import { config } from '../../config/env.js';
import { SmtpDeliveryProvider } from '../../modules/outreach/execution/smtp-delivery.provider.js';
import { resolveDatabasePath } from '../../database/backup.js';
import { logger } from '../../utils/logger.js';

export const settingsRouter = Router();
const log = logger.child('SettingsRouter');
const smtpProvider = new SmtpDeliveryProvider();

/**
 * GET /api/settings
 * Returns masked server configuration, safety flags, and provider policies.
 * Never returns passwords, bearer tokens, or raw connection strings.
 */
settingsRouter.get('/settings', async (_req: Request, res: Response) => {
  try {
    const caps = smtpProvider.getCapabilities();
    const policy = smtpProvider.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' });

    res.json({
      status: 'success',
      data: {
        general: {
          environment: config.NODE_ENV,
          appName: 'Local Operator Lead Generation System',
          version: '0.3.0 (Phase 13 Hardened)',
          mode: 'LOCAL_OPERATOR',
        },
        database: {
          provider: 'SQLite',
          path: resolveDatabasePath(config.DATABASE_URL),
          walMode: 'ACTIVE',
        },
        safety: {
          dryRun: config.DRY_RUN,
          outreachEnabled: config.OUTREACH_ENABLED,
          livePilotEnabled: config.LIVE_PILOT_ENABLED,
          outreachKillSwitch: config.OUTREACH_KILL_SWITCH,
          autoFollowupEnabled: config.AUTO_FOLLOWUP_ENABLED,
          testDataGuard: 'ACTIVE',
          maxSendsPerDay: config.LIVE_PILOT_MAX_SENDS_PER_DAY,
          maxSendsPerRun: config.LIVE_PILOT_MAX_SENDS_PER_RUN,
        },
        provider: {
          active: {
            name: 'SmtpDeliveryProvider',
            type: caps.providerType,
            configured: Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASSWORD),
            networkCapable: true,
            policyStatus: policy.status,
            reason: policy.reasonCode || policy.message,
            coldOutreachPermitted: false,
            isPersonalGmail: smtpProvider.isPersonalGmail(),
            smtpHost: config.SMTP_HOST || 'Not Configured',
            smtpPort: config.SMTP_PORT || 587,
            smtpUser: config.SMTP_USER ? 'CONFIGURED' : 'NOT_CONFIGURED',
            smtpPasswordState: config.SMTP_PASSWORD ? 'CONFIGURED' : 'NOT_CONFIGURED',
          },
          futureProviders: [
            {
              name: 'Dedicated Commercial SMTP',
              type: 'COMMERCIAL_SMTP',
              configured: false,
              networkCapable: false,
              policyStatus: 'REVIEW_REQUIRED',
              outreachContext: 'COLD_COMMERCIAL',
              note: 'Awaiting verified commercial domain with SPF, DKIM, and DMARC alignment.',
            },
            {
              name: 'Transactional API Service',
              type: 'TRANSACTIONAL_API',
              configured: false,
              networkCapable: false,
              policyStatus: 'REVIEW_REQUIRED',
              outreachContext: 'INBOUND_FOLLOWUP',
              note: 'Restricted to warm opt-in and transactional communications.',
            },
          ],
        },
      },
    });
  } catch (error: any) {
    log.error('Failed to get settings', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to retrieve settings' });
  }
});
