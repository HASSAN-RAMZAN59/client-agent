import { FollowUpProvider } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Mock follow-up scheduling provider.
 */
export class MockFollowUpProvider implements FollowUpProvider {
  public readonly providerName = 'MockFollowUpProvider';
  private log = logger.child('FollowUps');

  public async scheduleFollowUp(
    outreachId: string,
    delayDays: number = 3
  ): Promise<{ scheduledAt: Date }> {
    const scheduledAt = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000);
    this.log.info(`Follow-up scheduled for outreach [${outreachId}] on ${scheduledAt.toISOString()}`);
    return { scheduledAt };
  }
}
