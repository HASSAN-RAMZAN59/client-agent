import nodemailer from 'nodemailer';
import { config } from '../../../config/env.js';
import {
  OutreachDeliveryProvider,
  DeliveryParams,
  DeliveryResult,
} from '../../../types/index.js';
import { logger } from '../../../utils/logger.js';

export class SmtpDeliveryProvider implements OutreachDeliveryProvider {
  public readonly name = 'SmtpDeliveryProvider';
  public readonly isNetworkTransport = true;
  private log = logger.child('SmtpDeliveryProvider');

  public async isAvailable(): Promise<boolean> {
    if (!config.OUTREACH_ENABLED || config.DRY_RUN) {
      return false; // Fails closed unless explicitly enabled
    }

    return Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASSWORD);
  }

  public async send(params: DeliveryParams): Promise<DeliveryResult> {
    const attemptedAt = new Date();

    // FAIL-CLOSED: If DRY_RUN is active or OUTREACH_ENABLED is false, block real dispatch
    if (params.dryRun || config.DRY_RUN || !config.OUTREACH_ENABLED) {
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

  public getCapabilities() {
    return {
      supportsHtml: true,
      supportsAttachments: false,
    };
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
