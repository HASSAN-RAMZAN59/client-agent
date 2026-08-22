import { PrismaClient, Outreach } from '@prisma/client';
import { getPrismaClient } from '../client.js';
import { OutreachDraftResult, QualityBand } from '../../types/index.js';
import { ContentHasher } from '../../modules/personalization/hardening/content-hasher.js';
import { logger } from '../../utils/logger.js';

export class OutreachRepository {
  private db: PrismaClient;
  private log = logger.child('OutreachRepository');

  constructor(client: PrismaClient = getPrismaClient()) {
    this.db = client;
  }

  public async upsertDraft(
    leadId: string,
    draft: OutreachDraftResult,
    primaryContact?: { value?: string; type?: string },
    options: {
      contentHash?: string;
      qualityScore?: number;
      qualityBand?: QualityBand;
      evidenceValid?: boolean;
      identityValid?: boolean;
      expiresAt?: Date;
    } = {}
  ): Promise<Outreach> {
    const contentHash = options.contentHash || ContentHasher.hashDraft(draft.subject, draft.body);
    const qualityScore = options.qualityScore ?? draft.personalizationScore;
    const qualityBand = options.qualityBand ?? 'REVIEW_REQUIRED';
    const evidenceValid = options.evidenceValid ?? true;
    const identityValid = options.identityValid ?? true;
    const expiresAt = options.expiresAt || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    return this.db.outreach.upsert({
      where: {
        unique_lead_variant_draft: {
          leadId,
          variant: draft.variant,
        },
      },
      create: {
        leadId,
        channel: draft.channel,
        variant: draft.variant,
        subject: draft.subject,
        subjectVariants: JSON.stringify(draft.subjectVariants),
        body: draft.body,
        contentHash,
        personalizationScore: draft.personalizationScore,
        qualityScore,
        qualityBand,
        evidenceValid,
        identityValid,
        confidence: draft.confidence,
        provider: draft.provider,
        sourceEvidence: JSON.stringify(draft.sourceEvidence),
        salesAngle: JSON.stringify(draft.salesAngle),
        primaryContactValue: primaryContact?.value || null,
        primaryContactType: primaryContact?.type || null,
        qualityGuardWarnings: JSON.stringify(draft.qualityCheck.warnings),
        qualityGuardPassed: draft.qualityCheck.passed,
        expiresAt,
        status: draft.status,
      },
      update: {
        channel: draft.channel,
        subject: draft.subject,
        subjectVariants: JSON.stringify(draft.subjectVariants),
        body: draft.body,
        contentHash,
        personalizationScore: draft.personalizationScore,
        qualityScore,
        qualityBand,
        evidenceValid,
        identityValid,
        confidence: draft.confidence,
        provider: draft.provider,
        sourceEvidence: JSON.stringify(draft.sourceEvidence),
        salesAngle: JSON.stringify(draft.salesAngle),
        primaryContactValue: primaryContact?.value || null,
        primaryContactType: primaryContact?.type || null,
        qualityGuardWarnings: JSON.stringify(draft.qualityCheck.warnings),
        qualityGuardPassed: draft.qualityCheck.passed,
        expiresAt,
        status: draft.status,
      },
    });
  }

  public async getDraftsForLead(leadId: string): Promise<Outreach[]> {
    return this.db.outreach.findMany({
      where: { leadId },
      orderBy: { variant: 'asc' },
    });
  }

  public async getAllDrafts(limit: number = 20) {
    return this.db.outreach.findMany({
      take: limit,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        lead: {
          include: {
            business: true,
          },
        },
      },
    });
  }

  public async getDraftById(id: string) {
    return this.db.outreach.findFirst({
      where: {
        OR: [{ id }, { id: { startsWith: id } }],
      },
      include: {
        lead: {
          include: {
            business: {
              include: {
                audits: { orderBy: { updatedAt: 'desc' }, take: 1 },
                contacts: true,
              },
            },
          },
        },
      },
    });
  }

  public async approveDraft(id: string, operator: string = 'HUMAN_OPERATOR'): Promise<Outreach> {
    return this.db.outreach.update({
      where: { id },
      data: {
        status: 'READY_TO_SEND',
        approvedAt: new Date(),
        approvedBy: operator,
        rejectionReason: null,
      },
    });
  }

  public async rejectDraft(id: string, reason: string, operator: string = 'HUMAN_OPERATOR'): Promise<Outreach> {
    return this.db.outreach.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
        approvedBy: operator,
      },
    });
  }

  public async markStale(id: string): Promise<Outreach> {
    return this.db.outreach.update({
      where: { id },
      data: {
        status: 'STALE',
        rejectionReason: 'Underlying website audit or draft age exceeded staleness threshold.',
      },
    });
  }

  public async findDuplicateDraftByHash(contentHash: string, excludeDraftId?: string): Promise<Outreach | null> {
    return this.db.outreach.findFirst({
      where: {
        contentHash,
        id: excludeDraftId ? { not: excludeDraftId } : undefined,
      },
    });
  }

  public async checkCooldown(businessId: string, contactValue?: string | null, cooldownDays: number = 30): Promise<{ inCooldown: boolean; lastContactAt?: Date }> {
    const cooldownThreshold = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);

    const orConditions: any[] = [{ lead: { businessId } }];
    if (contactValue) {
      orConditions.push({ primaryContactValue: contactValue });
    }

    const recentOutreach = await this.db.outreach.findFirst({
      where: {
        sentAt: { gte: cooldownThreshold },
        OR: orConditions,
      },
      orderBy: { sentAt: 'desc' },
    });

    if (recentOutreach && recentOutreach.sentAt) {
      return {
        inCooldown: true,
        lastContactAt: recentOutreach.sentAt,
      };
    }

    return { inCooldown: false };
  }

  /**
   * ATOMIC CLAIM: Atomically locks a READY_TO_SEND draft to SENDING state.
   * Returns true if successfully claimed, false if claimed by another worker.
   */
  public async claimDraftForSending(id: string): Promise<boolean> {
    const updated = await this.db.outreach.updateMany({
      where: {
        id,
        status: 'READY_TO_SEND',
      },
      data: {
        status: 'SENDING',
        attemptedAt: new Date(),
      },
    });

    return updated.count > 0;
  }

  public async markSent(
    id: string,
    params: { messageId?: string; dryRun: boolean }
  ): Promise<Outreach> {
    return this.db.outreach.update({
      where: { id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        providerMessageId: params.messageId || null,
        dryRun: params.dryRun,
        error: null,
      },
    });
  }

  public async markFailed(
    id: string,
    error: string,
    dryRun: boolean = true
  ): Promise<Outreach> {
    return this.db.outreach.update({
      where: { id },
      data: {
        status: 'FAILED',
        error,
        dryRun,
      },
    });
  }

  public async getDailySentCount(date: Date = new Date()): Promise<number> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return this.db.outreach.count({
      where: {
        status: 'SENT',
        sentAt: { gte: startOfDay, lte: endOfDay },
      },
    });
  }

  public async getReadyToSendDrafts(limit: number = 10): Promise<any[]> {
    return this.db.outreach.findMany({
      where: { status: 'READY_TO_SEND' },
      take: limit,
      orderBy: [{ qualityScore: 'desc' }, { updatedAt: 'asc' }],
      include: {
        lead: {
          include: {
            business: {
              include: {
                audits: { orderBy: { updatedAt: 'desc' }, take: 1 },
                contacts: true,
              },
            },
          },
        },
      },
    });
  }
}
