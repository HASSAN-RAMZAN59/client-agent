import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../../database/client.js';
import { SuppressionRepository } from '../../../database/repositories/suppression.repository.js';
import { safetyControls } from '../../../config/safety.js';
import { config } from '../../../config/env.js';
import { createLogger } from '../../../utils/logger.js';
import { FollowUpStatus } from '../../../types/index.js';

export class FollowUpService {
  private db: PrismaClient;
  private suppressionRepo: SuppressionRepository;
  private log = createLogger('FollowUpService');

  constructor(customDb?: PrismaClient, customSuppressionRepo?: SuppressionRepository) {
    this.db = customDb || getPrismaClient();
    this.suppressionRepo = customSuppressionRepo || new SuppressionRepository(this.db);
  }

  public isAutoFollowUpEnabled(): boolean {
    return config.AUTO_FOLLOWUP_ENABLED;
  }

  public async scheduleFollowUp(
    outreachId: string,
    delayDays: number = 3,
    sequenceNumber: number = 1
  ): Promise<{ id: string; scheduledAt: Date; status: FollowUpStatus }> {
    const scheduledAt = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000);

    const followUp = await this.db.followUp.create({
      data: {
        outreachId,
        sequenceNumber,
        scheduledAt,
        status: 'FOLLOW_UP_PENDING',
      },
    });

    this.log.info(`Follow-up [${followUp.id}] scheduled for outreach [${outreachId}] on ${scheduledAt.toISOString()}`);
    return {
      id: followUp.id,
      scheduledAt,
      status: 'FOLLOW_UP_PENDING',
    };
  }

  public async processFollowUps(): Promise<{ processed: number; blockedReason: string }> {
    if (!this.isAutoFollowUpEnabled()) {
      const reason = 'AUTO_FOLLOWUP_ENABLED is false. Automatic follow-up execution is strictly disabled.';
      this.log.info(reason);
      return { processed: 0, blockedReason: reason };
    }

    return { processed: 0, blockedReason: 'Automatic follow-up sending requires explicit approval.' };
  }

  public async cancelFollowUp(followUpId: string, reason: string = 'Manual cancellation'): Promise<void> {
    await this.db.followUp.update({
      where: { id: followUpId },
      data: { status: 'FOLLOW_UP_CANCELLED' },
    });
    this.log.info(`Follow-up [${followUpId}] cancelled: ${reason}`);
  }
}

export const followUpService = new FollowUpService();
