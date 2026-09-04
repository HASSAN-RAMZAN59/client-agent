import { QueueService, queueService, LeadQueueFilters } from '../modules/campaigns/queue.service.js';
import { InteractiveReviewerService, interactiveReviewerService } from '../modules/outreach/review/interactive-reviewer.service.js';
import { LeadQueueItem, ReviewQueueItem, ReviewQueueFilters } from '../types/index.js';

export class LeadQueueService {
  constructor(private internalQueue: QueueService = queueService) {}

  public async getQueue(filters?: LeadQueueFilters): Promise<LeadQueueItem[]> {
    return await this.internalQueue.getLeadQueue(filters);
  }
}

export class ReviewQueueService {
  constructor(
    private internalQueue: QueueService = queueService,
    private reviewer: InteractiveReviewerService = interactiveReviewerService
  ) {}

  public async getQueue(limit: number = 50, filters?: ReviewQueueFilters): Promise<ReviewQueueItem[]> {
    return await this.internalQueue.getReviewQueue(limit, filters);
  }

  public async getPendingItems(options?: { includeTest?: boolean; limit?: number }) {
    return await this.reviewer.getPendingItems(options);
  }

  public async approveDraft(draftId: string, reviewerId: string = 'HUMAN_OPERATOR'): Promise<void> {
    await this.reviewer.approveOutreach(draftId, reviewerId);
  }

  public async rejectDraft(draftId: string, reason: string = 'Rejected by operator', reviewerId: string = 'HUMAN_OPERATOR'): Promise<void> {
    await this.reviewer.rejectOutreach(draftId, reason, reviewerId);
  }
}

export const leadQueueService = new LeadQueueService();
export const reviewQueueService = new ReviewQueueService();
