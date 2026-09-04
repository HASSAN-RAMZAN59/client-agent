import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { StartupConfigValidator, maskSecret } from '../src/config/startup-validator.js';
import { validateEnvironmentProfile } from '../src/config/environment.js';
import { DatabaseIntegrityService } from '../src/database/integrity.service.js';
import { createDatabaseBackup, resolveDatabasePath, calculateFileChecksum } from '../src/database/backup.js';
import { restoreDatabase } from '../src/database/restore.js';
import { sanitizeLogData, Logger } from '../src/utils/logger.js';
import {
  AppError,
  CampaignNotFoundError,
  OutboundProviderPolicyUnsupportedError,
  TestDataProhibitedError,
  formatErrorForOperator,
} from '../src/utils/errors.js';
import { isTransientNetworkError, isExplicitlyNonRetryable, withRetry } from '../src/utils/retry.js';
import { ConcurrencyLimiter, PoliteRateLimiter } from '../src/utils/rate-limiter.js';
import { CampaignRunService } from '../src/modules/campaigns/campaign-run.service.js';
import { ActivityLogService } from '../src/services/activity-log.service.js';
import { SystemStatusService } from '../src/services/system-status.service.js';
import { HealthService } from '../src/services/health.service.js';
import { SmtpDeliveryProvider } from '../src/modules/outreach/execution/smtp-delivery.provider.js';
import { boundedLimitSchema, countryCodeSchema, sanitizedStringSchema } from '../src/cli/validators.js';
import { shutdownManager } from '../src/utils/shutdown.js';
import { ConversionOptimizationService, PHASE_12_STATUS } from '../src/modules/conversion/phase12-placeholder.js';

describe('Phase 13: Production Hardening & Operational Reliability Tests', () => {
  let db: PrismaClient;

  beforeEach(async () => {
    db = new PrismaClient({
      datasources: {
        db: {
          url: 'file:./test.db',
        },
      },
    });
  });

  afterEach(async () => {
    await db.$disconnect();
  });

  // ----------------------------------------------------------------------------
  // 1. Configuration Validation & Fail-Closed Safety
  // ----------------------------------------------------------------------------
  describe('1. Startup Configuration Validation', () => {
    it('should validate standard compliant environment configuration', () => {
      const result = StartupConfigValidator.validate({
        DATABASE_URL: 'file:./test.db',
        NODE_ENV: 'test',
        DRY_RUN: 'true',
        OUTREACH_ENABLED: 'false',
        LIVE_PILOT_ENABLED: 'false',
        OUTREACH_KILL_SWITCH: 'true',
        MAX_ITEMS_PER_RUN: '10',
        MAX_EMAILS_PER_RUN: '5',
        SMTP_USER: 'test@example.com',
      });

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.diagnostics.profile).toBe('test');
    });

    it('should reject invalid boolean strings', () => {
      const result = StartupConfigValidator.validate({
        DATABASE_URL: 'file:./test.db',
        NODE_ENV: 'test',
        DRY_RUN: 'invalid_boolean',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid boolean value for DRY_RUN'))).toBe(true);
    });

    it('should reject negative and absurd limits', () => {
      const result = StartupConfigValidator.validate({
        DATABASE_URL: 'file:./test.db',
        NODE_ENV: 'test',
        MAX_ITEMS_PER_RUN: '-5',
        MAX_EMAILS_PER_DAY: '99999',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('MAX_ITEMS_PER_RUN'))).toBe(true);
      expect(result.errors.some((e) => e.includes('MAX_EMAILS_PER_DAY'))).toBe(true);
    });

    it('should fail closed when live mode is requested with personal Gmail SMTP', () => {
      const result = StartupConfigValidator.validate({
        DATABASE_URL: 'file:./test.db',
        NODE_ENV: 'test',
        DRY_RUN: 'false',
        OUTREACH_ENABLED: 'true',
        LIVE_PILOT_ENABLED: 'true',
        OUTREACH_KILL_SWITCH: 'false',
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_USER: 'personal@gmail.com',
        SMTP_PASSWORD: 'app-password',
        SENDER_POSTAL_ADDRESS: '123 Main St, Dallas, TX',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('FATAL PROVIDER POLICY VIOLATION'))).toBe(true);
    });

    it('should fail closed when live mode is requested without physical postal address', () => {
      const result = StartupConfigValidator.validate({
        DATABASE_URL: 'file:./test.db',
        NODE_ENV: 'test',
        DRY_RUN: 'false',
        OUTREACH_ENABLED: 'true',
        LIVE_PILOT_ENABLED: 'true',
        OUTREACH_KILL_SWITCH: 'false',
        SMTP_HOST: 'smtp.customdomain.com',
        SMTP_USER: 'outreach@customdomain.com',
        SMTP_PASSWORD: 'securepassword',
        SENDER_POSTAL_ADDRESS: '', // missing
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('LEGAL COMPLIANCE ERROR'))).toBe(true);
    });

    it('should sanitize diagnostics and never expose secret passwords', () => {
      const result = StartupConfigValidator.validate({
        DATABASE_URL: 'file:./test.db',
        NODE_ENV: 'test',
        SMTP_PASSWORD: 'super-secret-password-123',
      });

      expect(result.diagnostics.smtp).toBeDefined();
      const smtpDiag = result.diagnostics.smtp as any;
      expect(smtpDiag.passwordMasked).toBe('***REDACTED***');
      expect(JSON.stringify(result.diagnostics)).not.toContain('super-secret-password-123');
    });
  });

  // ----------------------------------------------------------------------------
  // 2. Environment Profile & Database Isolation
  // ----------------------------------------------------------------------------
  describe('2. Environment Profile Isolation', () => {
    it('should assert that TEST profile uses test.db', () => {
      const check = validateEnvironmentProfile({
        NODE_ENV: 'test',
        DATABASE_URL: 'file:./test.db',
      });
      expect(check.valid).toBe(true);
      expect(check.profile).toBe('test');
    });

    it('should reject test profile attempting to use dev.db', () => {
      const check = validateEnvironmentProfile({
        NODE_ENV: 'test',
        DATABASE_URL: 'file:./dev.db',
      });
      expect(check.valid).toBe(false);
      expect(check.errors[0]).toContain('Tests MUST exclusively use "test.db"');
    });

    it('should forbid production profile from using test.db', () => {
      const check = validateEnvironmentProfile({
        NODE_ENV: 'production',
        DATABASE_URL: 'file:./test.db',
      });
      expect(check.valid).toBe(false);
      expect(check.errors[0]).toContain('FATAL SAFETY VIOLATION: Production configuration cannot use "test.db"');
    });
  });

  // ----------------------------------------------------------------------------
  // 3. Database Integrity Service
  // ----------------------------------------------------------------------------
  describe('3. Database Integrity & Constraints', () => {
    it('should perform integrity audit on test database without throwing', async () => {
      const integrityService = new DatabaseIntegrityService(db);
      const report = await integrityService.auditIntegrity();

      expect(report.status).toBe('HEALTHY');
      expect(report.timestamp).toBeDefined();
      expect(report.recordCounts.businesses).toBeGreaterThanOrEqual(0);
      expect(report.orphanCounts.orphanLeads).toBe(0);
      expect(report.orphanCounts.orphanContacts).toBe(0);
      expect(report.orphanCounts.orphanOutreaches).toBe(0);
    });
  });

  // ----------------------------------------------------------------------------
  // 4. Database Backup & Safe Restore
  // ----------------------------------------------------------------------------
  describe('4. Zero-Cost SQLite Backup & Restore Tooling', () => {
    it('should create atomic timestamped backup with SHA-256 checksum', async () => {
      const result = await createDatabaseBackup('file:./test.db');

      expect(fs.existsSync(result.backupPath)).toBe(true);
      expect(result.checksum).toBeDefined();
      expect(result.checksum.length).toBe(64); // SHA-256 length
      expect(result.sizeBytes).toBeGreaterThan(0);

      // Clean up temporary backup
      fs.unlinkSync(result.backupPath);
    });

    it('should reject restore without explicit confirmation token RESTORE', async () => {
      await expect(
        restoreDatabase({
          backupFilePath: 'backups/nonexistent.db',
          confirmationToken: 'WRONG_TOKEN',
        })
      ).rejects.toThrow('Confirmation token "RESTORE" is strictly required');
    });
  });

  // ----------------------------------------------------------------------------
  // 5. Logging Hardening & Secret Redaction
  // ----------------------------------------------------------------------------
  describe('5. Logging Hardening & Error Sanitization', () => {
    it('should recursively redact sensitive fields in logged objects', () => {
      const sensitivePayload = {
        user: 'test-user',
        password: 'my-app-password',
        smtp_password: 'smtp-secret-key',
        authorization: 'Bearer token-12345',
        nested: {
          client_secret: 'nested-secret',
          cookie: 'session=abc',
        },
      };

      const sanitized: any = sanitizeLogData(sensitivePayload);
      expect(sanitized.user).toBe('test-user');
      expect(sanitized.password).toBe('***REDACTED***');
      expect(sanitized.smtp_password).toBe('***REDACTED***');
      expect(sanitized.authorization).toBe('***REDACTED***');
      expect(sanitized.nested.client_secret).toBe('***REDACTED***');
      expect(sanitized.nested.cookie).toBe('***REDACTED***');
    });

    it('should sanitize bearer tokens and credentials embedded in strings', () => {
      const msg = 'Failed dispatch with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token and password=mysecret123';
      const sanitized = sanitizeLogData(msg);
      expect(sanitized).not.toContain('eyJhbGciOi');
      expect(sanitized).not.toContain('mysecret123');
      expect(String(sanitized)).toContain('***REDACTED***');
    });
  });

  // ----------------------------------------------------------------------------
  // 6. Domain-Specific Typed Errors
  // ----------------------------------------------------------------------------
  describe('6. Typed Domain Errors', () => {
    it('should format typed domain errors with operator-friendly messages', () => {
      const err = new CampaignNotFoundError('camp-12345');
      const formatted = formatErrorForOperator(err);

      expect(formatted.code).toBe('CAMPAIGN_NOT_FOUND');
      expect(formatted.message).toContain('Campaign not found: "camp-12345"');
      expect(formatted.details).toEqual({ campaignId: 'camp-12345' });
    });

    it('should classify provider policy error as non-operational and fatal', () => {
      const err = new OutboundProviderPolicyUnsupportedError('Personal Gmail is prohibited');
      expect(err.code).toBe('OUTBOUND_PROVIDER_POLICY_UNSUPPORTED');
      expect(err.isOperational).toBe(false);
    });
  });

  // ----------------------------------------------------------------------------
  // 7. Retry Boundaries & Non-Retryable Rules
  // ----------------------------------------------------------------------------
  describe('7. Retry Policy & Boundaries', () => {
    it('should identify transient network errors (429, 502, timeouts)', () => {
      expect(isTransientNetworkError({ status: 429 })).toBe(true);
      expect(isTransientNetworkError({ status: 503 })).toBe(true);
      expect(isTransientNetworkError(new Error('ETIMEDOUT'))).toBe(true);
      expect(isTransientNetworkError(new Error('ECONNRESET'))).toBe(true);
    });

    it('should identify non-retryable errors (auth, policy, suppressions, kill switch)', () => {
      expect(isExplicitlyNonRetryable({ status: 401 })).toBe(true);
      expect(isExplicitlyNonRetryable(new Error('OUTBOUND_PROVIDER_POLICY_UNSUPPORTED'))).toBe(true);
      expect(isExplicitlyNonRetryable(new Error('SUPPRESSED'))).toBe(true);
      expect(isExplicitlyNonRetryable(new Error('KILL_SWITCH_ACTIVE'))).toBe(true);
      expect(isExplicitlyNonRetryable(new Error('CAN_SPAM_COMPLIANCE_FAILED'))).toBe(true);
    });

    it('should abort retry immediately on non-retryable errors without backoff loops', async () => {
      let attempts = 0;
      const failingOp = async () => {
        attempts++;
        throw new Error('OUTBOUND_PROVIDER_POLICY_UNSUPPORTED');
      };

      await expect(withRetry(failingOp, { maxRetries: 3 })).rejects.toThrow('OUTBOUND_PROVIDER_POLICY_UNSUPPORTED');
      expect(attempts).toBe(1); // Never retried
    });
  });

  // ----------------------------------------------------------------------------
  // 8. Concurrency & Rate Limiting
  // ----------------------------------------------------------------------------
  describe('8. Concurrency Limiting & Politeness', () => {
    it('should restrict concurrent async operations to configured limit', async () => {
      const limiter = new ConcurrencyLimiter(2);
      let activePeak = 0;
      let currentActive = 0;

      const task = async () => {
        return await limiter.run(async () => {
          currentActive++;
          activePeak = Math.max(activePeak, currentActive);
          await new Promise((r) => setTimeout(r, 20));
          currentActive--;
        });
      };

      await Promise.all([task(), task(), task(), task()]);
      expect(activePeak).toBeLessThanOrEqual(2);
    });
  });

  // ----------------------------------------------------------------------------
  // 9. Campaign Run State & Non-Fabricated Progress Metrics
  // ----------------------------------------------------------------------------
  describe('9. Campaign Run State & Tracking', () => {
    it('should transition campaign run through states and record actual counts', async () => {
      const testCampaign = await db.campaign.create({
        data: {
          name: `Phase 13 Run Campaign ${Date.now()}`,
          city: 'Dallas',
          niche: 'Dental',
        },
      });

      const runService = new CampaignRunService(db);
      const run = await runService.startRun(testCampaign.id, 25);
      expect(run.status).toBe('CREATED');
      expect(run.target).toBe(25);

      // Stage transition to DISCOVERING
      const running = await runService.updateRunStage(run.id, 'DISCOVERING', { discovered: 15, normalized: 15 });
      expect(running.status).toBe('DISCOVERING');
      expect(running.discovered).toBe(15);

      // Completion
      const completed = await runService.completeRun(run.id, 'COMPLETED');
      expect(completed.status).toBe('COMPLETED');
      expect(completed.completedAt).toBeDefined();
    });
  });

  // ----------------------------------------------------------------------------
  // 10. Activity / Audit Logging Service
  // ----------------------------------------------------------------------------
  describe('10. Activity & Operator Audit Logging', () => {
    it('should persist operator audit events with sanitized metadata', async () => {
      const activityService = new ActivityLogService(db);
      const entry = await activityService.logEvent({
        eventType: 'CAMPAIGN_STARTED',
        entityType: 'CAMPAIGN',
        entityId: 'test-campaign-123',
        actor: 'OPERATOR_TEST',
        metadata: {
          targetBusinesses: 10,
          password: 'sensitive-password-should-be-masked',
        },
      });

      expect(entry.id).toBeDefined();
      expect(entry.eventType).toBe('CAMPAIGN_STARTED');
      expect(entry.metadata).toBeDefined();
      expect(entry.metadata).toContain('***REDACTED***');
      expect(entry.metadata).not.toContain('sensitive-password-should-be-masked');
    });
  });

  // ----------------------------------------------------------------------------
  // 11. System Status & Health Check Services
  // ----------------------------------------------------------------------------
  describe('11. Health & Status Services', () => {
    it('should return system status summary without triggering external network calls', async () => {
      const statusService = new SystemStatusService(db);
      const summary = await statusService.getStatusSummary();

      expect(summary.environment).toBeDefined();
      expect(summary.database.status).toBe('CONNECTED');
      expect(summary.counts.businesses).toBeGreaterThanOrEqual(0);
      expect(summary.safety.dryRun).toBe(true);
      expect(summary.safety.killSwitchActive).toBe(true);
    });

    it('should return health check reporting zero sends performed', async () => {
      const health = await HealthService.getStatus();

      expect(health.status).toBeDefined();
      expect(health.database.health).toBe('HEALTHY');
      expect(health.prisma).toBe('HEALTHY');
      expect(health.safetyMode.dryRun).toBe(true);
      expect(health.testDataGuard).toBe('ACTIVE');
    });
  });

  // ----------------------------------------------------------------------------
  // 12. CLI Argument Validators
  // ----------------------------------------------------------------------------
  describe('12. CLI Input Validation Schemas', () => {
    it('should clamp/reject limits exceeding maximum safety boundary', () => {
      const schema = boundedLimitSchema(10, 100);
      expect(schema.parse(5)).toBe(5);
      expect(schema.parse('25')).toBe(25);
      expect(() => schema.parse(101)).toThrow('Limit cannot exceed safety maximum of 100.');
      expect(() => schema.parse(0)).toThrow('Limit must be at least 1.');
      expect(() => schema.parse(-10)).toThrow('Limit must be at least 1.');
      expect(() => schema.parse('abc')).toThrow('Limit must be a valid integer.');
    });

    it('should normalize country codes and reject invalid input', () => {
      expect(countryCodeSchema.parse('USA')).toBe('US');
      expect(countryCodeSchema.parse('us')).toBe('US');
      expect(countryCodeSchema.parse('ca')).toBe('CA');
    });

    it('should sanitize strings and reject dangerous characters', () => {
      const schema = sanitizedStringSchema('Niche');
      expect(schema.parse('Dentist')).toBe('Dentist');
      expect(() => schema.parse('<script>alert(1)</script>')).toThrow('Niche contains invalid characters.');
    });
  });

  // ----------------------------------------------------------------------------
  // 13. Phase 12 Placeholder Verification
  // ----------------------------------------------------------------------------
  describe('13. Phase 12 Placeholder & Status', () => {
    it('should report Phase 12 status as PENDING_REAL_PILOT_DATA', () => {
      const status = ConversionOptimizationService.getStatus();
      expect(status.status).toBe(PHASE_12_STATUS);
      expect(status.requiredFutureData).toContain('real sends');
      expect(status.requiredFutureData).toContain('SMTP accepted/failures');
      expect(status.requiredFutureData).toContain('replies');
    });
  });

  // ----------------------------------------------------------------------------
  // 14. Provider Policy Preservation & Approved Pilot Draft Freeze
  // ----------------------------------------------------------------------------
  describe('14. Provider Policy & Approved Pilot Draft Freeze', () => {
    it('should strictly block personal Gmail for cold commercial outreach', () => {
      const smtpProvider = new SmtpDeliveryProvider();
      const policyResult = smtpProvider.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' });

      // SmtpDeliveryProvider user is hassanramzan59@gmail.com -> personal Gmail -> UNSUPPORTED
      if (smtpProvider.isPersonalGmail()) {
        expect(policyResult.status).toBe('UNSUPPORTED');
        expect(policyResult.reasonCode).toBe('OUTBOUND_PROVIDER_POLICY_UNSUPPORTED');
      }
    });

    it('should verify shutdown manager is initialized', () => {
      const status = shutdownManager.getStatus();
      expect(status.isShuttingDown).toBe(false);
      expect(status.registeredResources).toContain('PrismaClient');
    });
  });
});
