import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../database/client.js';
import { logger } from '../../utils/logger.js';

export const leadsRouter = Router();
const log = logger.child('LeadsRouter');
const db: PrismaClient = getPrismaClient();

/**
 * GET /api/leads
 * Searchable, multi-filtered, paginated leads query.
 */
leadsRouter.get('/leads', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const {
      classification,
      channel,
      hasWebsite,
      verifiedEmail,
      hasAuditProblem,
      campaignId,
      city,
      niche,
      search,
    } = req.query as Record<string, string | undefined>;

    const where: any = {
      business: {
        NOT: [
          { source: { startsWith: 'test' } },
          { source: 'TEST_SUITE' },
          { name: { startsWith: 'Test' } },
        ],
      },
    };

    if (classification) {
      where.classification = classification.toUpperCase();
    }

    if (campaignId) {
      where.business.OR = [
        { campaignId },
        { campaignBusinesses: { some: { campaignId } } },
      ];
    }

    if (city) {
      where.business.city = { contains: city };
    }

    if (niche) {
      where.business.category = { contains: niche };
    }

    if (hasWebsite === 'true') {
      where.business.website = { not: null, notIn: ['', 'None'] };
    } else if (hasWebsite === 'false') {
      where.business.OR = [{ website: null }, { website: '' }, { website: 'None' }];
    }

    if (channel === 'EMAIL') {
      where.primaryContactType = 'EMAIL';
    } else if (channel === 'PHONE') {
      where.business.phone = { not: null };
    }

    if (verifiedEmail === 'true') {
      where.business.contacts = {
        some: {
          type: 'EMAIL',
          isVerified: true,
        },
      };
    }

    if (hasAuditProblem === 'true') {
      where.websiteProblemScore = { gt: 0 };
    }

    if (search && search.trim().length > 0) {
      const q = search.trim();
      where.AND = [
        {
          OR: [
            { business: { name: { contains: q } } },
            { business: { website: { contains: q } } },
            { business: { phone: { contains: q } } },
            { business: { contacts: { some: { value: { contains: q } } } } },
          ],
        },
      ];
    }

    const [total, leads] = await Promise.all([
      db.lead.count({ where }),
      db.lead.findMany({
        where,
        include: {
          business: {
            include: {
              audits: { orderBy: { createdAt: 'desc' }, take: 1 },
              contacts: true,
              campaign: true,
            },
          },
          outreach: { take: 1, orderBy: { createdAt: 'desc' } },
        },
        skip,
        take: limit,
        orderBy: [{ leadOpportunityScore: 'desc' }, { scoredAt: 'desc' }],
      }),
    ]);

    const formatted = leads.map((l) => {
      const b = l.business;
      const audit = b.audits?.[0];
      const verifiedContact = b.contacts?.find((c) => c.type === 'EMAIL' && c.isVerified);
      const phoneContact = b.contacts?.find((c) => c.type === 'PHONE') || (b.phone ? { value: b.phone } : null);
      const outreach = l.outreach?.[0];

      let topProblems: string[] = [];
      if (l.topProblems) {
        try {
          topProblems = JSON.parse(l.topProblems);
        } catch {}
      }

      return {
        id: l.id,
        businessId: b.id,
        businessName: b.name,
        city: b.city,
        country: b.country,
        niche: b.category,
        website: b.website || null,
        websiteScore: audit?.score ?? null,
        leadScore: l.leadOpportunityScore,
        leadClass: l.classification,
        priority: l.priority,
        email: verifiedContact?.value || verifiedContact?.email || l.primaryContactValue || null,
        isEmailVerified: Boolean(verifiedContact?.isVerified),
        phone: phoneContact?.value || b.phone || null,
        contactChannel: l.primaryContactType || (verifiedContact ? 'EMAIL' : b.phone ? 'PHONE' : 'NONE'),
        verifiedProblem: topProblems[0] || 'Website optimization opportunities',
        recommendedService: l.recommendedService,
        campaignId: b.campaignId || null,
        campaignName: b.campaign?.name || null,
        status: outreach?.status || l.status,
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
    log.error('Failed to query leads', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to query leads' });
  }
});

/**
 * GET /api/leads/:id
 * Deep lead inspection view including full audit findings, verified contacts, sales angle, and outreach variants.
 */
leadsRouter.get('/leads/:id', async (req: Request, res: Response) => {
  try {
    const leadId = req.params.id as string;
    const lead = await db.lead.findUnique({
      where: { id: leadId },
      include: {
        business: {
          include: {
            audits: { orderBy: { createdAt: 'desc' }, take: 1 },
            contacts: true,
            campaign: true,
          },
        },
        outreach: {
          include: {
            replies: true,
            followUps: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!lead) {
      return res.status(404).json({ status: 'error', message: 'Lead not found' });
    }

    const b = lead.business;
    const audit = b.audits?.[0];

    let auditFindings: any[] = [];
    let topProblems: string[] = [];
    let salesAngleObj: any = null;

    if (audit?.findings) {
      try {
        auditFindings = JSON.parse(audit.findings);
      } catch {}
    }
    if (lead.topProblems) {
      try {
        topProblems = JSON.parse(lead.topProblems);
      } catch {}
    }
    if (lead.salesAngle) {
      try {
        salesAngleObj = JSON.parse(lead.salesAngle);
      } catch {
        salesAngleObj = { reason: lead.salesAngle };
      }
    }

    const suppressions = await db.suppression.findMany({
      where: {
        OR: [
          { businessId: b.id },
          { targetValue: { in: b.contacts.map((c) => c.value).filter(Boolean) } },
        ],
      },
    });

    res.json({
      status: 'success',
      data: {
        id: lead.id,
        business: {
          id: b.id,
          name: b.name,
          rawDiscoveryName: b.name,
          identityConfidence: 'HIGH',
          city: b.city,
          country: b.country,
          address: b.address,
          niche: b.category,
          website: b.website,
          source: b.source,
          sourceUrl: b.sourceUrl,
        },
        audit: audit
          ? {
              score: audit.score,
              status: audit.status,
              mobile: audit.mobileScore,
              performance: audit.performanceScore,
              seo: audit.seoScore,
              accessibility: audit.accessibilityScore,
              ux: audit.uxScore,
              content: audit.contentScore,
              findings: auditFindings,
              topProblems,
              loadTimeMs: audit.loadTimeMs,
              mobileResponsive: audit.mobileResponsive,
              sslValid: audit.sslValid,
              hasContactForm: audit.hasContactForm,
            }
          : null,
        contacts: b.contacts.map((c) => ({
          id: c.id,
          type: c.type,
          value: c.value,
          channel: c.type,
          status: c.status,
          isVerified: c.isVerified,
          sourceUrl: c.sourceUrl,
          emailAsFound: c.emailAsFound || c.value,
          sourceContext: c.sourceContext,
          verifiedAt: c.discoveredAt,
        })),
        opportunity: {
          score: lead.leadOpportunityScore,
          classification: lead.classification,
          priority: lead.priority,
          recommendedService: lead.recommendedService,
          salesAngle: salesAngleObj,
          reasoning: lead.reasoning,
        },
        outreach: lead.outreach.map((o) => ({
          id: o.id,
          variant: o.variant,
          subject: o.finalSubject || o.subject,
          body: o.finalBody || o.body,
          status: o.status,
          approvalStatus: o.approvalStatus,
          approvedAt: o.approvedAt,
          approvedBy: o.approvedBy,
          qualityScore: o.qualityScore,
          qualityBand: o.qualityBand,
          contentHash: o.contentHash,
          sentAt: o.sentAt,
          repliesCount: o.replies.length,
          replies: o.replies,
        })),
        suppression: {
          isSuppressed: suppressions.length > 0,
          records: suppressions,
        },
      },
    });
  } catch (error: any) {
    log.error('Failed to get lead detail', { error: error?.message });
    res.status(500).json({ status: 'error', message: error?.message || 'Failed to fetch lead' });
  }
});
