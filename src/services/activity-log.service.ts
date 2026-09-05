import { PrismaClient, ActivityLog } from '@prisma/client';
import { getPrismaClient } from '../database/client.js';
import { sanitizeLogData } from '../utils/logger.js';
import { logger } from '../utils/logger.js';

export type ActivityEventType =
  | 'CAMPAIGN_CREATED'
  | 'CAMPAIGN_STARTED'
  | 'CAMPAIGN_DELETED'
  | 'BUSINESS_DISCOVERED'
  | 'AUDIT_COMPLETED'
  | 'CONTACT_VERIFIED'
  | 'DRAFT_CREATED'
  | 'DRAFT_APPROVED'
  | 'DRAFT_REJECTED'
  | 'DRY_RUN_EXECUTED'
  | 'PROVIDER_POLICY_BLOCKED'
  | 'SEND_ATTEMPTED'
  | 'SEND_FAILED'
  | 'REPLY_CLASSIFIED'
  | 'RECIPIENT_SUPPRESSED';

export type ActivityEntityType =
  | 'CAMPAIGN'
  | 'BUSINESS'
  | 'AUDIT'
  | 'CONTACT'
  | 'LEAD'
  | 'OUTREACH'
  | 'REPLY'
  | 'SUPPRESSION'
  | 'SYSTEM';

export interface LogEventParams {
  eventType: ActivityEventType;
  entityType: ActivityEntityType;
  entityId?: string;
  actor?: string;
  metadata?: Record<string, unknown>;
}

export class ActivityLogService {
  private db: PrismaClient;
  private log = logger.child('ActivityLogService');

  constructor(customDb?: PrismaClient) {
    this.db = customDb || getPrismaClient();
  }

  /**
   * Persists an operator audit event with strictly sanitized metadata (never exposing secrets).
   */
  public async logEvent(params: LogEventParams): Promise<ActivityLog> {
    const sanitizedMeta = params.metadata ? sanitizeLogData(params.metadata) : null;
    const metadataString = sanitizedMeta ? JSON.stringify(sanitizedMeta) : null;

    const record = await this.db.activityLog.create({
      data: {
        eventType: params.eventType,
        entityType: params.entityType,
        entityId: params.entityId || null,
        actor: params.actor || 'SYSTEM',
        metadata: metadataString,
      },
    });

    this.log.debug(`Recorded audit event: [${params.eventType}] for ${params.entityType} [${params.entityId || 'N/A'}]`);
    return record;
  }

  public async getRecentEvents(limit: number = 50, filters?: { eventType?: string; entityType?: string }): Promise<ActivityLog[]> {
    const where: any = {};
    if (filters?.eventType) where.eventType = filters.eventType;
    if (filters?.entityType) where.entityType = filters.entityType;

    return await this.db.activityLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }
}

export const activityLogService = new ActivityLogService();
