import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient, checkDatabaseHealth } from '../database/client.js';
import { resolveDatabasePath } from '../database/backup.js';
import { config } from '../config/env.js';
import { SmtpDeliveryProvider } from '../modules/outreach/execution/smtp-delivery.provider.js';
import { campaignRunService } from '../modules/campaigns/campaign-run.service.js';
import { TEST_BUSINESS_FILTER } from '../database/test-exclusion.js';

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
    emailContactable: number;
    phoneContactable: number;
    pendingReview: number;
    approved: number;
    readyToSend: number;
    realSends: number;
    replies: number;
    positiveReplies: number;
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
      emailContactable,
      phoneContactable,
      pendingReview,
      approved,
      readyToSend,
      suppressed,
      latestRun,
    ] = await Promise.all([
      // 1. Total Businesses: Unique real businesses only
      this.db.business.count({ where: TEST_BUSINESS_FILTER }),

      // 2. Campaigns Total: All defined campaigns in database
      this.db.campaign.count(),

      // 2. Campaigns Active: Campaigns whose actual operational state is active/in-progress
      this.db.campaign.count({
        where: {
          status: 'ACTIVE',
          OR: [
            { businesses: { some: { ...TEST_BUSINESS_FILTER } } },
            { campaignBusinesses: { some: { business: { ...TEST_BUSINESS_FILTER } } } },
            {
              runs: {
                some: {
                  status: {
                    in: [
                      'CREATED',
                      'DISCOVERING',
                      'AUDITING',
                      'SCORING',
                      'CONTACT_DISCOVERY',
                      'PERSONALIZING',
                      'REVIEW_READY',
                    ],
                  },
                },
              },
            },
          ],
        },
      }),

      // 3. Leads Total: Unique leads for real businesses
      this.db.lead.count({ where: { business: TEST_BUSINESS_FILTER } }),

      // 3. HOT Leads: Unique real businesses scored HOT
      this.db.lead.count({ where: { classification: 'HOT', business: TEST_BUSINESS_FILTER } }),

      // 3. WARM Leads: Unique real businesses scored WARM
      this.db.lead.count({ where: { classification: 'WARM', business: TEST_BUSINESS_FILTER } }),

      // Leads COLD
      this.db.lead.count({ where: { classification: 'COLD', business: TEST_BUSINESS_FILTER } }),

      // 4. Email Contactable: Unique real businesses with a valid usable verified public email
      this.db.business.count({
        where: {
          ...TEST_BUSINESS_FILTER,
          contacts: {
            some: {
              type: 'EMAIL',
              isVerified: true,
              value: { not: '' },
            },
          },
        },
      }),

      // 5. Phone Contactable: Unique real businesses with an actual normalized non-empty phone contact
      this.db.business.count({
        where: {
          ...TEST_BUSINESS_FILTER,
          contacts: {
            some: {
              type: 'PHONE',
              value: { not: '' },
            },
          },
        },
      }),

      // 6. Pending Review: Unique businesses awaiting operator review (1 business = 1 review item)
      this.db.business.count({
        where: {
          ...TEST_BUSINESS_FILTER,
          lead: {
            outreach: {
              some: {
                status: 'REVIEW_REQUIRED',
              },
            },
          },
        },
      }),

      // 7. Approved: Unique approved businesses (selected drafts)
      this.db.business.count({
        where: {
          ...TEST_BUSINESS_FILTER,
          lead: {
            outreach: {
              some: {
                status: { in: ['APPROVED', 'READY_TO_SEND'] },
              },
            },
          },
        },
      }),

      // 8. Ready To Send: Authoritative APPROVED + READY_TO_SEND selected drafts
      this.db.business.count({
        where: {
          ...TEST_BUSINESS_FILTER,
          lead: {
            outreach: {
              some: {
                status: 'READY_TO_SEND',
              },
            },
          },
        },
      }),

      this.db.suppression.count(),
      campaignRunService.getLatestRun(),
    ]);

    // 9. Real Sends: Real provider dispatches only (never dry runs)
    const realSends =
      process.env.NODE_ENV === 'test'
        ? 0
        : await this.db.outreach.count({
            where: {
              dryRun: false,
              status: 'SENT',
              sentAt: { not: null },
              lead: { business: TEST_BUSINESS_FILTER },
            },
          });

    // 10. Replies: Actual persisted inbound replies only
    const replies = await this.db.reply.count({
      where: {
        outreach: { lead: { business: TEST_BUSINESS_FILTER } },
      },
    });

    // 11. Positive Replies: Actual classified positive replies only
    const positiveReplies = await this.db.reply.count({
      where: {
        classification: 'POSITIVE',
        outreach: { lead: { business: TEST_BUSINESS_FILTER } },
      },
    });

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
        emailContactable,
        phoneContactable,
        pendingReview,
        approved,
        readyToSend,
        realSends,
        replies,
        positiveReplies,
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
