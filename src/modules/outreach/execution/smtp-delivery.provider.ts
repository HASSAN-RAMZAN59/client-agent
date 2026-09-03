import nodemailer from 'nodemailer';
import { config } from '../../../config/env.js';
import {
  OutreachDeliveryProvider,
  DeliveryParams,
  DeliveryResult,
  ProviderCapabilities,
  ProviderPolicyCheckResult,
  ProviderType,
} from '../../../types/index.js';
import { logger } from '../../../utils/logger.js';

export class SmtpDeliveryProvider implements OutreachDeliveryProvider {
  public readonly name = 'SmtpDeliveryProvider';
  public readonly isNetworkTransport = true;
  private log = logger.child('SmtpDeliveryProvider');

  public isPersonalGmail(): boolean {
    const host = (config.SMTP_HOST || '').toLowerCase();
    const user = (config.SMTP_USER || '').toLowerCase();
    const from = (config.SMTP_FROM_EMAIL || '').toLowerCase();

    return (
      host.includes('gmail.com') ||
      host.includes('googlemail.com') ||
      user.endsWith('@gmail.com') ||
      user.endsWith('@googlemail.com') ||
      from.endsWith('@gmail.com') ||
      from.endsWith('@googlemail.com')
    );
  }

  public async isAvailable(): Promise<boolean> {
    if (!config.OUTREACH_ENABLED || config.DRY_RUN) {
      return false; // Fails closed unless explicitly enabled
    }

    return Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASSWORD);
  }

  public getCapabilities(): ProviderCapabilities {
    const isGmail = this.isPersonalGmail();
    const providerType: ProviderType = isGmail ? 'GMAIL_SMTP' : 'CUSTOM_SMTP';
    const policyResult = this.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' });

    return {
      supportsHtml: true,
      supportsAttachments: false,
      supportsCommercialColdOutreach: policyResult.status === 'PERMITTED',
      providerPolicyStatus: policyResult.status,
      providerType,
    };
  }

  public getProviderPolicyStatus(context?: {
    outreachType?: 'COLD_COMMERCIAL' | 'TRANSACTIONAL' | 'REPLY' | 'PERSONAL';
  }): ProviderPolicyCheckResult {
    const outreachType = context?.outreachType || 'COLD_COMMERCIAL';

    if (this.isPersonalGmail()) {
      if (outreachType === 'COLD_COMMERCIAL') {
        return {
          status: 'UNSUPPORTED',
          reasonCode: 'OUTBOUND_PROVIDER_POLICY_UNSUPPORTED',
          message:
            'Google Gmail Program Policies prohibit using personal Gmail (@gmail.com) SMTP for unsolicited commercial cold outreach.',
        };
      } else {
        return {
          status: 'PERMITTED',
          message: `Personal Gmail is permitted for ${outreachType} communication.`,
        };
      }
    }

    // Default for unknown or unverified custom SMTP providers
    return {
      status: 'REVIEW_REQUIRED',
      reasonCode: 'PROVIDER_POLICY_REVIEW_REQUIRED',
      message:
        'Unknown or custom SMTP provider policy requires verification before commercial cold outreach.',
    };
  }

  public getSettingsSummary() {
    const isConfigured = Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASSWORD);
    const caps = this.getCapabilities();
    return {
      configured: isConfigured ? 'YES' : 'NO',
      networkCapable: isConfigured ? 'YES' : 'NO',
      coldCommercialOutreachEligible: caps.supportsCommercialColdOutreach ? 'YES' : 'NO',
      providerType: caps.providerType,
      providerPolicyStatus: caps.providerPolicyStatus,
    };
  }

  public async send(params: DeliveryParams): Promise<DeliveryResult> {
    const attemptedAt = new Date();

    // 1. Safe simulation: If dryRun is explicitly requested, simulate locally without network dispatch
    if (params.dryRun) {
      this.log.info(
        `[DRY RUN / SAFE GUARD] Simulated SMTP dispatch for "${params.recipient}" (Subject: "${params.subject}")`
      );
      return {
        success: true,
        status: 'SIMULATED',
        messageId: `sim-smtp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        attemptedAt,
        providerName: this.name,
        dryRun: true,
      };
    }

    // 2. Real dispatch requested (params.dryRun === false):
    // Provider Policy Gate: Block real commercial cold dispatch if provider policy is unsupported or requires review
    const policyCheck = this.getProviderPolicyStatus({
      outreachType: params.outreachType || 'COLD_COMMERCIAL',
    });

    if (policyCheck.status !== 'PERMITTED') {
      const reasonCode = policyCheck.reasonCode || 'OUTBOUND_PROVIDER_POLICY_UNSUPPORTED';
      this.log.warn(`[PROVIDER POLICY BLOCKED] Live email blocked for "${params.recipient}": ${reasonCode}`);
      return {
        success: false,
        status: 'FAILED',
        error: reasonCode,
        providerName: this.name,
        attemptedAt,
        dryRun: false,
      };
    }

    // 3. FAIL-CLOSED Safety Flags: If global DRY_RUN is active or OUTREACH_ENABLED is false
    if (config.DRY_RUN || !config.OUTREACH_ENABLED) {
      this.log.info(
        `[DRY RUN / SAFE GUARD] Simulated SMTP dispatch for "${params.recipient}" (Subject: "${params.subject}")`
      );
      return {
        success: true,
        status: 'SIMULATED',
        messageId: `sim-smtp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        attemptedAt,
        providerName: this.name,
        dryRun: true,
      };
    }

    if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD) {
      return {
        success: false,
        status: 'FAILED',
        error: 'INVALID_CONFIGURATION: SMTP credentials not provided in environment.',
        providerName: this.name,
        attemptedAt,
        dryRun: false,
      };
    }

    try {
      const transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        auth: {
          user: config.SMTP_USER,
          pass: config.SMTP_PASSWORD,
        },
      });

      const mailOptions = {
        from: `"${config.SMTP_FROM_NAME}" <${config.SMTP_FROM_EMAIL}>`,
        to: params.recipient,
        subject: params.subject,
        text: params.body,
      };

      const info = await transporter.sendMail(mailOptions);

      this.log.info(`[SMTP DELIVERED] Email sent to "${params.recipient}" [ID: ${info.messageId}]`);

      return {
        success: true,
        status: 'SENT',
        messageId: info.messageId,
        attemptedAt,
        providerName: this.name,
        dryRun: false,
      };
    } catch (err: any) {
      // SECURITY: Sanitize error message to ensure passwords/credentials are NEVER logged
      const sanitizedError = this.sanitizeError(err?.message || 'Unknown SMTP transport error');
      this.log.error(`[SMTP ERROR] Delivery failed for "${params.recipient}": ${sanitizedError}`);

      return {
        success: false,
        status: 'FAILED',
        error: sanitizedError,
        providerName: this.name,
        attemptedAt,
        dryRun: false,
      };
    }
  }

  private sanitizeError(errMsg: string): string {
    let sanitized = errMsg;
    if (config.SMTP_PASSWORD) {
      sanitized = sanitized.split(config.SMTP_PASSWORD).join('***REDACTED***');
    }
    if (config.SMTP_USER) {
      sanitized = sanitized.split(config.SMTP_USER).join('***USER***');
    }
    return sanitized;
  }
}
