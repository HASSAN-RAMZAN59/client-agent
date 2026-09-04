import fs from 'fs';
import { checkDatabaseHealth } from '../database/client.js';
import { resolveDatabasePath } from '../database/backup.js';
import { config } from '../config/env.js';
import { SmtpDeliveryProvider } from '../modules/outreach/execution/smtp-delivery.provider.js';

export interface DetailedHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  nodeVersion: string;
  environment: string;
  database: {
    health: 'HEALTHY' | 'UNHEALTHY';
    connected: boolean;
    provider: string;
    path: string;
    accessible: boolean;
    latencyMs?: number;
    error?: string;
  };
  prisma: 'HEALTHY' | 'UNHEALTHY';
  discoveryConfig: 'READY' | 'WARNING';
  playwright: 'READY' | 'UNAVAILABLE';
  smtpConfig: 'CONFIGURED' | 'NOT_CONFIGURED';
  providerPolicy: 'PERMITTED' | 'REVIEW_REQUIRED' | 'UNSUPPORTED';
  safetyMode: {
    dryRun: boolean;
    outreachEnabled: boolean;
    livePilotEnabled: boolean;
    killSwitchActive: boolean;
    autoFollowupEnabled: boolean;
  };
  testDataGuard: 'ACTIVE';
}

export class HealthService {
  public static async getStatus(): Promise<DetailedHealthStatus> {
    const dbHealth = await checkDatabaseHealth();
    const dbPath = resolveDatabasePath(config.DATABASE_URL);
    let diskAccessible = false;

    try {
      if (fs.existsSync(dbPath)) {
        fs.accessSync(dbPath, fs.constants.R_OK | fs.constants.W_OK);
        diskAccessible = true;
      }
    } catch {
      diskAccessible = false;
    }

    // Playwright check (safe without browser launch)
    let playwrightStatus: 'READY' | 'UNAVAILABLE' = 'READY';
    try {
      const { chromium } = await import('playwright');
      if (!chromium) {
        playwrightStatus = 'UNAVAILABLE';
      }
    } catch {
      playwrightStatus = 'UNAVAILABLE';
    }

    // SMTP & Provider Policy check
    const smtpProvider = new SmtpDeliveryProvider();
    const smtpConfigured = Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASSWORD);
    const policyResult = smtpProvider.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' });

    // Discovery config check
    const discoveryReady = config.DISCOVERY_OSM_ENABLED || config.DISCOVERY_DDG_ENABLED;

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (!dbHealth.connected || !diskAccessible) {
      overallStatus = 'unhealthy';
    } else if (playwrightStatus === 'UNAVAILABLE' || !discoveryReady) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      version: '0.3.0 (Phase 13 Hardened)',
      nodeVersion: process.version,
      environment: config.NODE_ENV,
      database: {
        health: dbHealth.connected ? 'HEALTHY' : 'UNHEALTHY',
        connected: dbHealth.connected,
        provider: 'SQLite',
        path: dbPath,
        accessible: diskAccessible,
        latencyMs: dbHealth.latencyMs,
        error: dbHealth.error,
      },
      prisma: dbHealth.connected ? 'HEALTHY' : 'UNHEALTHY',
      discoveryConfig: discoveryReady ? 'READY' : 'WARNING',
      playwright: playwrightStatus,
      smtpConfig: smtpConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      providerPolicy: policyResult.status,
      safetyMode: {
        dryRun: config.DRY_RUN,
        outreachEnabled: config.OUTREACH_ENABLED,
        livePilotEnabled: config.LIVE_PILOT_ENABLED,
        killSwitchActive: config.OUTREACH_KILL_SWITCH,
        autoFollowupEnabled: config.AUTO_FOLLOWUP_ENABLED,
      },
      testDataGuard: 'ACTIVE',
    };
  }
}
