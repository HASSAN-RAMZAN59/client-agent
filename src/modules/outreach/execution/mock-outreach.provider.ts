import {
  OutreachDeliveryProvider,
  DeliveryParams,
  DeliveryResult,
} from '../../../types/index.js';
import { logger } from '../../../utils/logger.js';

export class MockOutreachProvider implements OutreachDeliveryProvider {
  public readonly name = 'MockOutreachProvider';
  private log = logger.child('MockOutreachProvider');
  private simulateFailure = false;
  private simulateRateLimit = false;

  public setSimulateFailure(fail: boolean): void {
    this.simulateFailure = fail;
  }

  public setSimulateRateLimit(rateLimit: boolean): void {
    this.simulateRateLimit = rateLimit;
  }

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async send(params: DeliveryParams): Promise<DeliveryResult> {
    const attemptedAt = new Date();

    if (this.simulateRateLimit) {
      this.log.warn(`[RATE LIMIT SIMULATED] Provider rate limit encountered for recipient "${params.recipient}".`);
      return {
        success: false,
        status: 'FAILED',
        error: 'RATE_LIMITED: 429 Too Many Requests in simulated provider.',
        providerName: this.name,
        attemptedAt,
        dryRun: params.dryRun,
      };
    }

    if (this.simulateFailure) {
      this.log.warn(`[FAILURE SIMULATED] Simulated delivery failure for recipient "${params.recipient}".`);
      return {
        success: false,
        status: 'FAILED',
        error: 'NETWORK_ERROR: Simulated connection reset by peer.',
        providerName: this.name,
        attemptedAt,
        dryRun: params.dryRun,
      };
    }

    const messageId = `mock-msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    this.log.info(
      `[SIMULATED DISPATCH] Successfully simulated message delivery to "${params.recipient}" (Subject: "${params.subject}") [ID: ${messageId}]`
    );

    return {
      success: true,
      status: params.dryRun ? 'SIMULATED' : 'SENT',
      messageId,
      attemptedAt,
      providerName: this.name,
      dryRun: params.dryRun,
    };
  }

  public getCapabilities() {
    return {
      supportsHtml: true,
      supportsAttachments: false,
    };
  }
}
