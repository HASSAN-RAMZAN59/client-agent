import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient, checkDatabaseHealth } from '../database/client.js';
import { resolveDatabasePath } from '../database/backup.js';
import { config } from '../config/env.js';
import { SmtpDeliveryProvider } from '../modules/outreach/execution/smtp-delivery.provider.js';
import { campaignRunService } from '../modules/campaigns/campaign-run.service.js';

export interface SystemStatusSummary {
  environment: string;
  database: {
    status: 'CONNECTED' | 'DISCONNECTED';
    provider: string;
    path: string;
    sizeBytes: number;
    latencyMs?: number;
    error?: string;
  };
  counts: {
    businesses: number;
    campaignsTotal: number;
    campaignsActive: number;
    leadsTotal: number;
    leadsHot: number;
    leadsWarm: number;
    leadsCold: number;
    pendingReview: number;
    approved: number;
    suppressed: number;
  };
  provider: {
    name: string;
    type: string;
    configured: boolean;
    policyStatus: string;
    coldOutreachPermitted: boolean;
    isPersonalGmail: boolean;
  };
  safety: {
    dryRun: boolean;
    outreachEnabled: boolean;
    livePilotEnabled: boolean;
    killSwitchActive: boolean;
    autoFollowupEnabled: boolean;
    testDataGuard: 'ACTIVE';
  };
  lastCampaignRun?: {
    id: string;
    status: string;
    target: number;
    startedAt: Date;
    completedAt?: Date | null;
  } | null;
  lastError?: string | null;
}

export class SystemStatusService {
  private db: PrismaClient;
  private smtpProvider: SmtpDeliveryProvider;

  constructor(customDb?: PrismaClient) {
    this.db = customDb || getPrismaClient();
    this.smtpProvider = new SmtpDeliveryProvider();
  }

  public async getStatusSummary(): Promise<SystemStatusSummary> {
    const dbHealth = await checkDatabaseHealth();
    const dbPath = resolveDatabasePath(config.DATABASE_URL);
    let sizeBytes = 0;
    try {
      if (fs.existsSync(dbPath)) {
        sizeBytes = fs.statSync(dbPath).size;
      }
    } catch {
      sizeBytes = 0;
    }

    const [
      businesses,
      campaignsTotal,
      campaignsActive,
      leadsTotal,
      leadsHot,
      leadsWarm,
      leadsCold,
      pendingReview,
      approved,
      suppressed,
      latestRun,
    ] = await Promise.all([
      this.db.business.count(),
      this.db.campaign.count(),
      this.db.campaign.count({ where: { status: 'ACTIVE' } }),
      this.db.lead.count(),
      this.db.lead.count({ where: { classification: 'HOT' } }),
      this.db.lead.count({ where: { classification: 'WARM' } }),
      this.db.lead.count({ where: { classification: 'COLD' } }),
      this.db.outreach.count({ where: { status: 'REVIEW_REQUIRED' } }),
      this.db.outreach.count({ where: { status: { in: ['APPROVED', 'READY_TO_SEND'] } } }),
      this.db.suppression.count(),
      campaignRunService.getLatestRun(),
    ]);

    const caps = this.smtpProvider.getCapabilities();
    const policy = this.smtpProvider.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' });
    const isPersonal = this.smtpProvider.isPersonalGmail();

    return {
      environment: config.NODE_ENV,
      database: {
        status: dbHealth.connected ? 'CONNECTED' : 'DISCONNECTED',
        provider: 'SQLite',
        path: dbPath,
        sizeBytes,
        latencyMs: dbHealth.latencyMs,
        error: dbHealth.error,
      },
      counts: {
        businesses,
        campaignsTotal,
        campaignsActive,
        leadsTotal,
        leadsHot,
        leadsWarm,
        leadsCold,
        pendingReview,
        approved,
        suppressed,
      },
      provider: {
        name: 'SmtpDeliveryProvider',
        type: caps.providerType,
        configured: Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASSWORD),
        policyStatus: policy.status,
        coldOutreachPermitted: caps.supportsCommercialColdOutreach,
        isPersonalGmail: isPersonal,
      },
      safety: {
        dryRun: config.DRY_RUN,
        outreachEnabled: config.OUTREACH_ENABLED,
        livePilotEnabled: config.LIVE_PILOT_ENABLED,
        killSwitchActive: config.OUTREACH_KILL_SWITCH,
        autoFollowupEnabled: config.AUTO_FOLLOWUP_ENABLED,
        testDataGuard: 'ACTIVE',
      },
      lastCampaignRun: latestRun
        ? {
            id: latestRun.id,
            status: latestRun.status,
            target: latestRun.target,
            startedAt: latestRun.startedAt,
            completedAt: latestRun.completedAt,
          }
        : null,
      lastError: null,
    };
  }
}

export const systemStatusService = new SystemStatusService();
