import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';
import {
  interactiveReviewerService,
  activityLogService,
} from '../../services/index.js';
import { ContentHasher } from '../../modules/personalization/hardening/content-hasher.js';
import { logger } from '../../utils/logger.js';

export const reviewRouter = Router();
const log = logger.child('ReviewRouter');
const db: PrismaClient = getPrismaClient();

/**
 * GET /api/review
 * Campaign selection is required.
 * Returns pending review items grouped by business (1 Business = 1 Review Card with 3 Variants).
 */
reviewRouter.get('/review', async (req: Request, res: Response) => {
  try {
    const campaignId = req.query.campaignId as string;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));

    if (!campaignId) {
      return res.status(400).json({
        status: 'error',
        message: 'Campaign selection is required to load review queue',
      });
    }

    const groups = await interactiveReviewerService.getPendingBusinessGroups({
      campaignId,
      limit,
      includeTest: false,
    });

    res.json({
      status: 'success',
      data: {
        campaignId,
        totalItems: groups.length,
        items: groups,
      },
    });
  } catch (error: any) {
    log.error('Failed to get review queue', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to load review queue' });
  }
});

/**
 * PATCH /api/review/:outreachId
 * Edits draft subject and body.
 * In accordance with CONTENT_CHANGED_AFTER_APPROVAL, editing invalidates any existing approval and requires re-approval.
 */
reviewRouter.patch('/review/:outreachId', async (req: Request, res: Response) => {
  try {
    const outreachId = req.params.outreachId as string;
    const { subject, body } = req.body;

    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      return res.status(400).json({ status: 'error', message: 'Subject is required' });
    }
    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      return res.status(400).json({ status: 'error', message: 'Body is required' });
    }

    const existing = await db.outreach.findUnique({
      where: { id: outreachId },
      include: { lead: { include: { business: true } } },
    });

    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Outreach record not found' });
    }

    const now = new Date();
    const newHash = ContentHasher.hashDraft(subject.trim(), body.trim());

    // If previously approved, invalidate approval to force explicit operator re-approval
    const wasApproved = existing.status === 'APPROVED' || existing.status === 'READY_TO_SEND';

    const updated = await db.outreach.update({
      where: { id: outreachId },
      data: {
        originalSubject: existing.originalSubject || existing.subject,
        originalBody: existing.originalBody || existing.body,
        finalSubject: subject.trim(),
        finalBody: body.trim(),
        subject: subject.trim(),
        body: body.trim(),
        contentHash: newHash,
        status: wasApproved ? 'REVIEW_REQUIRED' : existing.status,
        approvalStatus: wasApproved ? 'REVIEW_REQUIRED' : existing.approvalStatus,
        approvedAt: wasApproved ? null : existing.approvedAt,
        approvedBy: wasApproved ? null : existing.approvedBy,
        editTimestamp: now,
      },
    });

    log.info(`Draft [${outreachId}] updated by operator. ${wasApproved ? 'Approval invalidated due to content modification.' : ''}`);

    res.json({
      status: 'success',
      data: {
        outreach: updated,
        approvalInvalidated: wasApproved,
        message: wasApproved
          ? 'Draft content updated. Previous approval invalidated — re-approval required.'
          : 'Draft updated successfully.',
      },
    });
  } catch (error: any) {
    log.error('Failed to update draft', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to edit draft' });
  }
});

/**
 * POST /api/review/:outreachId/approve
 * Explicit human approval of ONE variant.
 * Strictly archives all other variants for this lead and transitions approved variant to READY_TO_SEND.
 */
reviewRouter.post('/review/:outreachId/approve', async (req: Request, res: Response) => {
  try {
    const outreachId = req.params.outreachId as string;
    const operator = req.body?.operator || 'HUMAN_OPERATOR';

    const existing = await db.outreach.findUnique({
      where: { id: outreachId },
      include: {
        lead: {
          include: {
            business: true,
            outreach: true,
          },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Outreach record not found' });
    }

    const allLeadOutreachIds = existing.lead.outreach.map((o) => o.id);

    await interactiveReviewerService.approveSelectedVariant(
      outreachId,
      allLeadOutreachIds,
      operator
    );

    await activityLogService.logEvent({
      eventType: 'DRAFT_APPROVED',
      entityType: 'OUTREACH',
      entityId: outreachId,
      actor: operator,
      metadata: {
        businessId: existing.lead.business.id,
        businessName: existing.lead.business.name,
        variant: existing.variant,
      },
    });

    const approvedRecord = await db.outreach.findUnique({ where: { id: outreachId } });

    res.json({
      status: 'success',
      data: {
        outreach: approvedRecord,
        approvedBy: operator,
        approvedAt: approvedRecord?.approvedAt,
        selectedVariant: existing.variant,
        contentHash: approvedRecord?.contentHash,
        archivedCount: allLeadOutreachIds.length - 1,
      },
    });
  } catch (error: any) {
    log.error('Failed to approve draft variant', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to approve draft' });
  }
});

/**
 * POST /api/review/reject-business
 * Rejects all draft variants for a business group with reason.
 */
reviewRouter.post('/review/reject-business', async (req: Request, res: Response) => {
  try {
    const { businessId, reason, operator } = req.body;

    if (!businessId) {
      return res.status(400).json({ status: 'error', message: 'businessId is required' });
    }

    const business = await db.business.findUnique({
      where: { id: businessId },
      include: {
        lead: {
          include: { outreach: true },
        },
      },
    });

    if (!business || !business.lead) {
      return res.status(404).json({ status: 'error', message: 'Business lead not found' });
    }

    const outreachIds = business.lead.outreach.map((o) => o.id);
    const rejectionReason = reason || 'Rejected by operator in review queue';

    await db.outreach.updateMany({
      where: { id: { in: outreachIds } },
      data: {
        status: 'REJECTED',
        approvalStatus: 'REJECTED',
        rejectionReason,
      },
    });

    await activityLogService.logEvent({
      eventType: 'DRAFT_REJECTED',
      entityType: 'BUSINESS',
      entityId: businessId,
      actor: operator || 'HUMAN_OPERATOR',
      metadata: {
        businessName: business.name,
        reason: rejectionReason,
        rejectedDraftsCount: outreachIds.length,
      },
    });

    res.json({
      status: 'success',
      data: {
        businessId,
        rejectedCount: outreachIds.length,
        reason: rejectionReason,
      },
    });
  } catch (error: any) {
    log.error('Failed to reject business review item', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to reject business' });
  }
});
