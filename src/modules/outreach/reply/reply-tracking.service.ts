import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../../database/client.js';
import { SuppressionRepository } from '../../../database/repositories/suppression.repository.js';
import { createLogger } from '../../../utils/logger.js';
import {
  InboundReplyInput,
  InboundReplyRecord,
  ReplyClassification,
  FollowUpStatus,
} from '../../../types/index.js';

export class ReplyTrackingService {
  private db: PrismaClient;
  private suppressionRepo: SuppressionRepository;
  private log = createLogger('ReplyTrackingService');

  constructor(customDb?: PrismaClient, customSuppressionRepo?: SuppressionRepository) {
    this.db = customDb || getPrismaClient();
    this.suppressionRepo = customSuppressionRepo || new SuppressionRepository(this.db);
  }

  public classifyReplyBody(body: string): {
    classification: ReplyClassification;
    sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
    intentCategory?: string;
  } {
    const text = body.toLowerCase().trim();

    // 1. Unsubscribe / Opt-out
    if (
      text.includes('unsubscribe') ||
      text.includes('remove me') ||
      text.includes('opt out') ||
      text.includes('stop emailing') ||
      text.includes('take me off your list')
    ) {
      return { classification: 'UNSUBSCRIBE', sentiment: 'NEGATIVE', intentCategory: 'UNSUBSCRIBE' };
    }

    // 2. Not interested / Do not contact
    if (
      text.includes('not interested') ||
      text.includes('no thanks') ||
      text.includes('not looking') ||
      text.includes('do not contact') ||
      text.includes('dont email')
    ) {
      return { classification: 'NOT_INTERESTED', sentiment: 'NEGATIVE', intentCategory: 'DO_NOT_CONTACT' };
    }

    // 3. Out of office / Auto-reply
    if (
      text.includes('out of office') ||
      text.includes('automatic reply') ||
      text.includes('on annual leave') ||
      text.includes('away from my desk')
    ) {
      return { classification: 'OUT_OF_OFFICE', sentiment: 'NEUTRAL', intentCategory: 'AUTO_REPLY' };
    }

    // 4. Positive interest
    if (
      text.includes('yes') ||
      text.includes('sure') ||
      text.includes('send details') ||
      text.includes('send over') ||
      text.includes('sounds good') ||
      text.includes('lets talk') ||
      text.includes("let's talk") ||
      text.includes('call me') ||
      text.includes('schedule a call') ||
      text.includes('show me')
    ) {
      return { classification: 'POSITIVE', sentiment: 'POSITIVE', intentCategory: 'CALL_REQUEST' };
    }

    // 5. Question / Inquiry
    if (
      text.includes('how much') ||
      text.includes('pricing') ||
      text.includes('cost') ||
      text.includes('what are your rates') ||
      text.includes('timeline') ||
      text.includes('portfolio') ||
      text.includes('where are you located') ||
      text.endsWith('?')
    ) {
      return { classification: 'QUESTION', sentiment: 'POSITIVE', intentCategory: 'PRICING_QUESTION' };
    }

    // 6. General negative
    if (
      text.includes('already have') ||
      text.includes('in-house') ||
      text.includes('have a web developer') ||
      text.includes('not right now')
    ) {
      return { classification: 'NEGATIVE', sentiment: 'NEGATIVE', intentCategory: 'NOT_INTERESTED' };
    }

    return { classification: 'UNKNOWN', sentiment: 'NEUTRAL', intentCategory: 'GENERAL_RESPONSE' };
  }

  public async recordReply(input: InboundReplyInput): Promise<InboundReplyRecord> {
    const outreach = await this.db.outreach.findUnique({
      where: { id: input.outreachId },
      include: { lead: { include: { business: true } } },
    });

    if (!outreach) {
      throw new Error(`Outreach draft [${input.outreachId}] not found for incoming reply.`);
    }

    const { classification, sentiment, intentCategory } = this.classifyReplyBody(input.replyBody);
    const recipientEmail = input.senderEmail || input.recipient || outreach.primaryContactValue || '';
    const now = input.replyReceivedAt || new Date();

    let followUpStatus: FollowUpStatus = 'FOLLOW_UP_PENDING';

    // If recipient unsubscribed or is not interested -> automatically suppress!
    if (classification === 'UNSUBSCRIBE' || classification === 'NOT_INTERESTED') {
      followUpStatus = 'SUPPRESSED';
      if (recipientEmail) {
        await this.suppressionRepo.addSuppression({
          targetValue: recipientEmail,
          targetType: 'EMAIL',
          reason: 'UNSUBSCRIBED',
          notes: `Automated suppression triggered by incoming reply classified as ${classification}`,
          businessId: outreach.lead?.businessId,
        });
        this.log.warn(`Suppressed recipient ${recipientEmail} due to reply classification [${classification}].`);
      }
    } else if (classification === 'POSITIVE') {
      followUpStatus = 'FOLLOW_UP_APPROVED';
    }

    // Persist Reply record
    const reply = await this.db.reply.create({
      data: {
        outreachId: outreach.id,
        senderEmail: input.senderEmail || recipientEmail,
        recipient: recipientEmail,
        businessId: outreach.lead?.businessId,
        messageId: input.messageId,
        threadId: input.threadId,
        body: input.replyBody,
        classification,
        replyClassification: classification,
        confidence: 0.95,
        sentiment,
        intentCategory,
        followUpStatus,
        replyReceivedAt: now,
      },
    });

    // Update Outreach status
    await this.db.outreach.update({
      where: { id: outreach.id },
      data: {
        status: classification === 'UNSUBSCRIBE' ? 'UNSUBSCRIBED' : 'REPLIED',
      },
    });

    this.log.info(`Recorded reply [${reply.id}] for outreach [${outreach.id}] (Classification: ${classification})`);

    return {
      id: reply.id,
      outreachId: outreach.id,
      senderEmail: reply.senderEmail || undefined,
      recipient: reply.recipient || undefined,
      businessId: reply.businessId || undefined,
      messageId: reply.messageId || undefined,
      threadId: reply.threadId || undefined,
      body: reply.body || '',
      classification,
      sentiment,
      followUpStatus,
      replyReceivedAt: reply.replyReceivedAt || now,
    };
  }

  public async getRepliesSummary(campaignId?: string): Promise<{
    total: number;
    positive: number;
    negative: number;
    question: number;
    unsubscribe: number;
    outOfOffice: number;
    unknown: number;
  }> {
    const where: any = {};
    if (campaignId) {
      where.outreach = {
        lead: {
          business: {
            campaignId,
          },
        },
      };
    }

    const replies = await this.db.reply.findMany({ where });

    return {
      total: replies.length,
      positive: replies.filter((r) => r.classification === 'POSITIVE').length,
      negative: replies.filter((r) => r.classification === 'NEGATIVE').length,
      question: replies.filter((r) => r.classification === 'QUESTION').length,
      unsubscribe: replies.filter((r) => r.classification === 'UNSUBSCRIBE' || r.classification === 'NOT_INTERESTED').length,
      outOfOffice: replies.filter((r) => r.classification === 'OUT_OF_OFFICE').length,
      unknown: replies.filter((r) => r.classification === 'UNKNOWN' || r.classification === 'NEUTRAL').length,
    };
  }
}

export const replyTrackingService = new ReplyTrackingService();
