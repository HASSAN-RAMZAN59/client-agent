import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';
import { logger } from '../../utils/logger.js';

export const repliesRouter = Router();
const log = logger.child('RepliesRouter');
const db: PrismaClient = getPrismaClient();

/**
 * GET /api/replies
 * Lists incoming replies classified by intent category.
 */
repliesRouter.get('/replies', async (req: Request, res: Response) => {
  try {
    const classification = req.query.classification as string | undefined;

    const where: any = {};
    if (classification) {
      where.classification = classification.toUpperCase();
    }

    const replies = await db.reply.findMany({
      where,
      include: {
        outreach: {
          include: {
            lead: {
              include: {
                business: {
                  include: {
                    campaign: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const enriched = await Promise.all(
      replies.map(async (r) => {
        const b = r.outreach?.lead?.business;
        const sender = r.senderEmail || 'Unknown Sender';

        const suppression = sender
          ? await db.suppression.findFirst({
              where: {
                OR: [
                  { targetValue: sender },
                  ...(b?.id ? [{ businessId: b.id }] : []),
                ],
              },
            })
          : null;

        return {
          id: r.id,
          outreachId: r.outreachId,
          businessId: b?.id || null,
          businessName: b?.name || 'Unknown Business',
          campaignName: b?.campaign?.name || 'General Outreach',
          senderEmail: sender,
          receivedAt: r.replyReceivedAt || r.createdAt,
          classification: r.classification,
          sentiment: r.sentiment || 'NEUTRAL',
          intentCategory: r.intentCategory || 'GENERAL',
          body: r.body,
          suppressionStatus: suppression
            ? `SUPPRESSED (${suppression.reason})`
            : r.classification === 'UNSUBSCRIBE'
            ? 'SUPPRESSED'
            : 'ACTIVE',
          isPositive: r.classification === 'POSITIVE' || r.classification === 'POSITIVE_INTEREST',
          isQuestion: r.classification === 'QUESTION',
          isUnsubscribe: r.classification === 'UNSUBSCRIBE',
        };
      })
    );

    res.json({
      status: 'success',
      data: {
        total: enriched.length,
        items: enriched,
      },
    });
  } catch (error: any) {
    log.error('Failed to get replies', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to query replies' });
  }
});
