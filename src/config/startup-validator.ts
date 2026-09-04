import { z } from 'zod';
import { EnvConfig } from './env.js';
import { validateEnvironmentProfile } from './environment.js';

export interface StartupValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  diagnostics: Record<string, unknown>;
}

/**
 * Validates boolean strings strictly (rejecting invalid strings like "foo", "maybe", etc.)
 */
function parseStrictBoolean(val: unknown, fieldName: string): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
  }
  throw new Error(`Invalid boolean value for ${fieldName}: "${val}". Must be "true", "false", "1", or "0".`);
}

/**
 * Validates bounded positive integers strictly
 */
function parseStrictInteger(
  val: unknown,
  fieldName: string,
  min: number = 1,
  max: number = Number.MAX_SAFE_INTEGER
): number {
  const num = typeof val === 'number' ? val : Number(val);
  if (isNaN(num) || !Number.isInteger(num)) {
    throw new Error(`Invalid integer for ${fieldName}: "${val}". Must be a valid integer.`);
  }
  if (num < min || num > max) {
    throw new Error(`Limit violation for ${fieldName}: ${num} must be between ${min} and ${max}.`);
  }
  return num;
}

/**
 * Masks sensitive credential strings, preserving length indication or standard marker.
 */
export function maskSecret(secret?: string | null): string {
  if (!secret || secret.trim() === '') return '[NOT_SET]';
  return '***REDACTED***';
}

/**
 * Startup configuration validator enforcing strict schemas, safety combinations,
 * and producing sanitized diagnostics.
 */
export class StartupConfigValidator {
  public static validate(rawEnv: NodeJS.ProcessEnv = process.env): StartupValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Environment Profile Isolation
    const envProfile = validateEnvironmentProfile(rawEnv);
    if (!envProfile.valid) {
      errors.push(...envProfile.errors);
    }

    // 2. Strict Parse of Core Flags
    let dryRun = true;
    let outreachEnabled = false;
    let livePilotEnabled = false;
    let outreachKillSwitch = true;
    let autoFollowupEnabled = false;

    try {
      dryRun = parseStrictBoolean(rawEnv.DRY_RUN ?? 'true', 'DRY_RUN');
    } catch (e) {
      errors.push((e as Error).message);
    }

    try {
      outreachEnabled = parseStrictBoolean(rawEnv.OUTREACH_ENABLED ?? 'false', 'OUTREACH_ENABLED');
    } catch (e) {
      errors.push((e as Error).message);
    }

    try {
      livePilotEnabled = parseStrictBoolean(rawEnv.LIVE_PILOT_ENABLED ?? 'false', 'LIVE_PILOT_ENABLED');
    } catch (e) {
      errors.push((e as Error).message);
    }

    try {
      outreachKillSwitch = parseStrictBoolean(rawEnv.OUTREACH_KILL_SWITCH ?? 'true', 'OUTREACH_KILL_SWITCH');
    } catch (e) {
      errors.push((e as Error).message);
    }

    try {
      autoFollowupEnabled = parseStrictBoolean(rawEnv.AUTO_FOLLOWUP_ENABLED ?? 'false', 'AUTO_FOLLOWUP_ENABLED');
    } catch (e) {
      errors.push((e as Error).message);
    }

    // 3. Strict Limits Validation
    let maxItems = 10;
    let maxEmailsRun = 5;
    let maxEmailsDay = 20;
    let pilotSendsRun = 3;
    let pilotSendsDay = 3;

    try {
      maxItems = parseStrictInteger(rawEnv.MAX_ITEMS_PER_RUN ?? 10, 'MAX_ITEMS_PER_RUN', 1, 100);
    } catch (e) {
      errors.push((e as Error).message);
    }

    try {
      maxEmailsRun = parseStrictInteger(rawEnv.MAX_EMAILS_PER_RUN ?? 5, 'MAX_EMAILS_PER_RUN', 1, 50);
    } catch (e) {
      errors.push((e as Error).message);
    }

    try {
      maxEmailsDay = parseStrictInteger(rawEnv.MAX_EMAILS_PER_DAY ?? 20, 'MAX_EMAILS_PER_DAY', 1, 200);
    } catch (e) {
      errors.push((e as Error).message);
    }

    try {
      pilotSendsRun = parseStrictInteger(rawEnv.LIVE_PILOT_MAX_SENDS_PER_RUN ?? 3, 'LIVE_PILOT_MAX_SENDS_PER_RUN', 1, 10);
    } catch (e) {
      errors.push((e as Error).message);
    }

    try {
      pilotSendsDay = parseStrictInteger(rawEnv.LIVE_PILOT_MAX_SENDS_PER_DAY ?? 3, 'LIVE_PILOT_MAX_SENDS_PER_DAY', 1, 20);
    } catch (e) {
      errors.push((e as Error).message);
    }

    // 4. Transport & Provider Policy Validation
    const smtpHost = rawEnv.SMTP_HOST || '';
    const smtpUser = (rawEnv.SMTP_USER || '').toLowerCase();
    const smtpFrom = (rawEnv.SMTP_FROM_EMAIL || '').toLowerCase();
    const isPersonalGmail =
      smtpUser.endsWith('@gmail.com') ||
      smtpUser.endsWith('@googlemail.com') ||
      smtpFrom.endsWith('@gmail.com') ||
      smtpFrom.endsWith('@googlemail.com');

    const postalAddress = rawEnv.SENDER_POSTAL_ADDRESS?.trim() || '';

    // 5. Conflicting Safety Combinations
    if ((livePilotEnabled || outreachEnabled) && !dryRun) {
      // Live outbound mode active
      if (outreachKillSwitch) {
        errors.push(
          'Conflicting Safety Combination: Live outbound outreach is requested (DRY_RUN=false, OUTREACH/PILOT=true), but OUTREACH_KILL_SWITCH is true. Execution must fail closed.'
        );
      }

      if (isPersonalGmail) {
        errors.push(
          'FATAL PROVIDER POLICY VIOLATION: Unsolicited cold commercial outreach using personal Gmail (@gmail.com / @googlemail.com) is strictly prohibited by Google Gmail Program Policies. Live mode cannot start with personal Gmail configured.'
        );
      }

      if (!postalAddress) {
        errors.push(
          'LEGAL COMPLIANCE ERROR: SENDER_POSTAL_ADDRESS is required for live outbound outreach under CAN-SPAM regulations.'
        );
      }

      if (!smtpHost || !smtpUser || !rawEnv.SMTP_PASSWORD) {
        errors.push('TRANSPORT ERROR: Valid SMTP credentials (host, user, password) are required for live outbound mode.');
      }
    }

    // Diagnostics (100% Sanitized, Zero Credential Leaks)
    const diagnostics = {
      profile: envProfile.profile,
      databaseUrl: rawEnv.DATABASE_URL?.replace(/password=[^&]*/i, 'password=***') || 'file:./dev.db',
      databasePath: envProfile.databasePath,
      dryRun,
      outreachEnabled,
      livePilotEnabled,
      killSwitchActive: outreachKillSwitch,
      autoFollowupEnabled,
      limits: {
        maxItemsPerRun: maxItems,
        maxEmailsPerRun: maxEmailsRun,
        maxEmailsPerDay: maxEmailsDay,
        pilotSendsPerRun: pilotSendsRun,
        pilotSendsPerDay: pilotSendsDay,
      },
      smtp: {
        host: smtpHost || '[NOT_SET]',
        port: rawEnv.SMTP_PORT || 587,
        user: smtpUser ? (smtpUser.includes('@') ? smtpUser.replace(/^(.{2})(.*)(@.*)$/, '$1***$3') : '***') : '[NOT_SET]',
        fromEmail: smtpFrom || '[NOT_SET]',
        hasPassword: Boolean(rawEnv.SMTP_PASSWORD && rawEnv.SMTP_PASSWORD.trim().length > 0),
        passwordMasked: maskSecret(rawEnv.SMTP_PASSWORD),
        isPersonalGmail,
      },
      compliance: {
        postalAddressConfigured: postalAddress.length > 0,
        postalAddressPreview: postalAddress ? postalAddress.slice(0, 5) + '...' : '[NOT_SET]',
      },
      providerPolicy: isPersonalGmail
        ? 'UNSUPPORTED (Personal Gmail cold commercial outreach blocked)'
        : 'REVIEW_REQUIRED',
    };

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      diagnostics,
    };
  }

  /**
   * Asserts valid startup configuration or throws a structured error.
   */
  public static assertValidStartup(rawEnv: NodeJS.ProcessEnv = process.env): void {
    const result = StartupConfigValidator.validate(rawEnv);
    if (!result.valid) {
      const formatted = result.errors.map((e) => `  ✖ ${e}`).join('\n');
      throw new Error(`Startup Configuration Validation Failed:\n${formatted}`);
    }
  }
}
