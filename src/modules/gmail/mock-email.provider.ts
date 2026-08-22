import { EmailProvider, SendEmailResult } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { safetyControls } from '../../config/safety.js';

/**
 * Mock email provider that strictly adheres to the global DRY_RUN safety policy.
 * When DRY_RUN is true (default), emails are never sent and only simulated locally.
 * Future phases will plug in standard Gmail API OAuth2 sending with human-in-the-loop review.
 */
export class MockEmailProvider implements EmailProvider {
  public readonly providerName = 'MockEmailProvider';
  private log = logger.child('Email');

  public async sendEmail(params: {
    to: string;
    subject: string;
    body: string;
  }): Promise<SendEmailResult> {
    const isDryRun = safetyControls.isDryRun();

    if (isDryRun) {
      this.log.info(`[DRY RUN ACTIVATED] Simulated sending email to "${params.to}" (Subject: "${params.subject}")`);
      this.log.debug(`[DRY RUN BODY]:\n${params.body}`);

      return {
        messageId: `mock-msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        status: 'SIMULATED',
        recipient: params.to,
        sentAt: new Date(),
        details: 'Simulated dispatch in DRY_RUN mode. No actual network request or email sent.',
      };
    }

    // If DRY_RUN is false, in Phase 1 this is still a safe mock preventing actual dispatch
    this.log.warn(`DRY_RUN is false, but Real Gmail API Provider is not yet connected in Phase 1. Simulating execution.`);
    return {
      messageId: `mock-msg-${Date.now()}`,
      status: 'SIMULATED',
      recipient: params.to,
      sentAt: new Date(),
      details: 'Phase 1 mock dispatch.',
    };
  }
}
