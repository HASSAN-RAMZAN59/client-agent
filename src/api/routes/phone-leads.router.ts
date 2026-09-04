import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';
import { logger } from '../../utils/logger.js';

export const phoneLeadsRouter = Router();
const log = logger.child('PhoneLeadsRouter');
const db: PrismaClient = getPrismaClient();

/**
 * GET /api/phone-leads
 * Lists leads that have phone contact info for manual phone outreach.
 */
phoneLeadsRouter.get('/phone-leads', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const where: any = {
      business: {
        phone: { not: null },
        NOT: [
          { source: { startsWith: 'test' } },
          { source: 'TEST_SUITE' },
          { name: { startsWith: 'Test' } },
        ],
      },
    };

    const [total, leads] = await Promise.all([
      db.lead.count({ where }),
      db.lead.findMany({
        where,
        include: {
          business: {
            include: {
              audits: { orderBy: { createdAt: 'desc' }, take: 1 },
              campaign: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { leadOpportunityScore: 'desc' },
      }),
    ]);

    const formatted = leads.map((l) => {
      const b = l.business;
      const audit = b.audits?.[0];

      let topProblems: string[] = [];
      if (l.topProblems) {
        try {
          topProblems = JSON.parse(l.topProblems);
        } catch {}
      }

      let callObjective = 'Discuss website improvements & mobile usability';
      if (audit && audit.score < 50) {
        callObjective = 'Address critical technical & mobile website failures';
      } else if (!b.website) {
        callObjective = 'Offer turnkey online presence & local search setup';
      }

      return {
        leadId: l.id,
        businessId: b.id,
        businessName: b.name,
        phone: b.phone,
        city: b.city,
        country: b.country,
        niche: b.category,
        leadScore: l.leadOpportunityScore,
        leadClass: l.classification,
        website: b.website || 'None',
        verifiedProblem: topProblems[0] || 'Mobile and performance optimization',
        callObjective,
        status: l.status,
        notes: l.notes || '',
        updatedAt: l.updatedAt,
      };
    });

    res.json({
      status: 'success',
      data: {
        items: formatted,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    log.error('Failed to get phone leads', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to query phone leads' });
  }
});

/**
 * PATCH /api/phone-leads/:id/contacted
 * Operator toggles or marks lead as contacted manually.
 */
phoneLeadsRouter.patch('/phone-leads/:id/contacted', async (req: Request, res: Response) => {
  try {
    const leadId = req.params.id as string;
    const { status } = req.body;

    const updated = await db.lead.update({
      where: { id: leadId },
      data: {
        status: status || 'CONTACTED',
      },
    });

    res.json({
      status: 'success',
      data: updated,
    });
  } catch (error: any) {
    log.error('Failed to mark phone lead contacted', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to update phone lead' });
  }
});

/**
 * POST /api/phone-leads/:id/notes
 * Operator adds manual call notes.
 */
phoneLeadsRouter.post('/phone-leads/:id/notes', async (req: Request, res: Response) => {
  try {
    const leadId = req.params.id as string;
    const { note } = req.body;

    const existing = await db.lead.findUnique({ where: { id: leadId } });
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Lead not found' });
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const newNotes = existing.notes
      ? `${existing.notes}\n[${timestamp}] ${note}`
      : `[${timestamp}] ${note}`;

    const updated = await db.lead.update({
      where: { id: leadId },
      data: { notes: newNotes },
    });

    res.json({
      status: 'success',
      data: updated,
    });
  } catch (error: any) {
    log.error('Failed to add phone lead notes', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to add notes' });
  }
});
