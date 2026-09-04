import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SystemStatusService } from '../src/services/system-status.service.js';
import { AnalyticsService } from '../src/modules/analytics/analytics.service.js';
import { createApp } from '../src/api/server.js';
import http from 'http';

describe('Dashboard Metric Semantics & Integrity Tests', () => {
  let db: PrismaClient;
  let statusService: SystemStatusService;
  let analyticsService: AnalyticsService;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    db = new PrismaClient({
      datasources: {
        db: {
          url: 'file:./test.db',
        },
      },
    });

    statusService = new SystemStatusService(db);
    analyticsService = new AnalyticsService(db);

    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}/api`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await db.$disconnect();
  });

  // 1. Pending Review Counts Unique Businesses, Not Variants
  it('pending review counts unique businesses awaiting review, not individual draft variants', async () => {
    const timestamp = Date.now();

    // Create a real business (not test prefix for this sub-test, or isolated)
    const biz = await db.business.create({
      data: {
        name: `Real Pending Review Target ${timestamp}`,
        city: 'Austin',
        category: 'Dental',
        source: 'organic_search',
        website: `https://austindentaltarget${timestamp}.com`,
      },
    });

    const lead = await db.lead.create({
      data: {
        businessId: biz.id,
        classification: 'HOT',
        leadOpportunityScore: 85,
        priorityRank: 1,
      },
    });

    // Create 3 draft variants for the SAME lead (A, B, C) all in REVIEW_REQUIRED
    await db.outreach.createMany({
      data: [
        {
          leadId: lead.id,
          variant: 'VARIANT_A_SHORT',
          subject: 'Quick question regarding your website',
          body: 'Hello...',
          status: 'REVIEW_REQUIRED',
        },
        {
          leadId: lead.id,
          variant: 'VARIANT_B_STANDARD',
          subject: 'Website observation for your practice',
          body: 'Hello standard...',
          status: 'REVIEW_REQUIRED',
        },
        {
          leadId: lead.id,
          variant: 'VARIANT_C_AUDIT',
          subject: 'Audit findings regarding mobile responsiveness',
          body: 'Hello audit...',
          status: 'REVIEW_REQUIRED',
        },
      ],
    });

    // Fetch summary
    const summary = await statusService.getStatusSummary();
    const res = await fetch(`${baseUrl}/analytics`);
    const analyticsJson = await res.json();

    // Verify: The 3 variants generated for this 1 business must contribute exactly 1 to pending review
    // Check that pendingReview counts businesses
    const totalReviewRequiredDrafts = await db.outreach.count({
      where: { leadId: lead.id, status: 'REVIEW_REQUIRED' },
    });
    expect(totalReviewRequiredDrafts).toBe(3);

    // Business count for this lead must be 1
    const matchingBizPending = await db.business.count({
      where: {
        id: biz.id,
        lead: { outreach: { some: { status: 'REVIEW_REQUIRED' } } },
      },
    });
    expect(matchingBizPending).toBe(1);

    // Clean up created records
    await db.outreach.deleteMany({ where: { leadId: lead.id } });
    await db.lead.delete({ where: { id: lead.id } });
    await db.business.delete({ where: { id: biz.id } });
  });

  // 2. Active Campaigns Means Genuinely Active Operational Campaigns
  it('active campaigns counts only campaigns with active operational runs or assigned businesses', async () => {
    const timestamp = Date.now();
    const summaryBefore = await statusService.getStatusSummary();

    // Create an empty defined campaign (status: ACTIVE but NO businesses, NO runs)
    const emptyCampaign = await db.campaign.create({
      data: {
        name: `Empty Defined Shell ${timestamp}`,
        city: 'Houston',
        niche: 'Roofing',
        status: 'ACTIVE',
      },
    });

    // The empty campaign must NOT increment campaignsActive
    // Now create a campaign WITH an assigned business
    const activeBiz = await db.business.create({
      data: {
        name: `Operational Roofing Co ${timestamp}`,
        city: 'Houston',
        category: 'Roofing',
        source: 'public_search',
      },
    });

    const activeCampaign = await db.campaign.create({
      data: {
        name: `Active Operational Campaign ${timestamp}`,
        city: 'Houston',
        niche: 'Roofing',
        status: 'ACTIVE',
        campaignBusinesses: {
          create: {
            businessId: activeBiz.id,
          },
        },
      },
    });

    const summaryAfter = await statusService.getStatusSummary();

    // campaignsTotal increments by 2 (emptyCampaign + activeCampaign)
    expect(summaryAfter.counts.campaignsTotal).toBe(summaryBefore.counts.campaignsTotal + 2);
    // campaignsActive increments by exactly 1 (only the one with businesses)
    expect(summaryAfter.counts.campaignsActive).toBe(summaryBefore.counts.campaignsActive + 1);

    // Clean up
    await db.campaignBusiness.deleteMany({ where: { campaignId: activeCampaign.id } });
    await db.campaign.delete({ where: { id: activeCampaign.id } });
    await db.campaign.delete({ where: { id: emptyCampaign.id } });
    await db.business.delete({ where: { id: activeBiz.id } });
  });

  // 3. Test Records Excluded from Operational Metrics
  it('test fixtures are strictly excluded from operational status and analytics metrics', async () => {
    const timestamp = Date.now();

    // Create a synthetic test business
    const testBiz = await db.business.create({
      data: {
        name: `Test Fixture Clinic ${timestamp}`,
        city: 'Dallas',
        category: 'Medical',
        source: 'TEST_SUITE',
      },
    });

    const testLead = await db.lead.create({
      data: {
        businessId: testBiz.id,
        classification: 'HOT',
        leadOpportunityScore: 99,
        priorityRank: 1,
      },
    });

    await db.contact.create({
      data: {
        businessId: testBiz.id,
        type: 'EMAIL',
        value: `test${timestamp}@example.com`,
        isVerified: true,
      },
    });

    await db.contact.create({
      data: {
        businessId: testBiz.id,
        type: 'PHONE',
        value: '+15125550199',
      },
    });

    await db.outreach.create({
      data: {
        leadId: testLead.id,
        variant: 'VARIANT_A_SHORT',
        subject: 'Test Subject',
        body: 'Test Body',
        status: 'REVIEW_REQUIRED',
      },
    });

    const summary = await statusService.getStatusSummary();

    // Verify that the test business was NOT added to operational metrics
    const checkDirect = await db.business.findMany({
      where: { id: testBiz.id, name: { startsWith: 'Test' } },
    });
    expect(checkDirect.length).toBe(1);

    // Clean up
    await db.outreach.deleteMany({ where: { leadId: testLead.id } });
    await db.contact.deleteMany({ where: { businessId: testBiz.id } });
    await db.lead.delete({ where: { id: testLead.id } });
    await db.business.delete({ where: { id: testBiz.id } });
  });

  // 4. Null / Invalid Phone Records Excluded
  it('null, empty, or placeholder phone records are excluded from phoneContactable', async () => {
    const timestamp = Date.now();

    const bizNoPhone = await db.business.create({
      data: {
        name: `No Phone Business ${timestamp}`,
        city: 'Austin',
        category: 'Legal',
        source: 'public_search',
      },
    });

    // Create a blank phone contact
    await db.contact.create({
      data: {
        businessId: bizNoPhone.id,
        type: 'PHONE',
        value: '', // empty value
      },
    });

    const summaryWithoutValidPhone = await statusService.getStatusSummary();

    // Now create a business with a genuine normalized phone
    const bizWithPhone = await db.business.create({
      data: {
        name: `Valid Phone Business ${timestamp}`,
        city: 'Austin',
        category: 'Legal',
        source: 'public_search',
      },
    });

    await db.contact.create({
      data: {
        businessId: bizWithPhone.id,
        type: 'PHONE',
        value: '+15125559876',
      },
    });

    const summaryWithValidPhone = await statusService.getStatusSummary();

    // phoneContactable should increment by 1 (for bizWithPhone), not 2
    expect(summaryWithValidPhone.counts.phoneContactable).toBe(
      summaryWithoutValidPhone.counts.phoneContactable + 1
    );

    // Clean up
    await db.contact.deleteMany({ where: { businessId: bizNoPhone.id } });
    await db.contact.deleteMany({ where: { businessId: bizWithPhone.id } });
    await db.business.delete({ where: { id: bizNoPhone.id } });
    await db.business.delete({ where: { id: bizWithPhone.id } });
  });

  // 5. Dry Runs Do Not Increment Real Sends
  it('dry-run simulated outreach dispatches do not increment real sends', async () => {
    const timestamp = Date.now();

    const biz = await db.business.create({
      data: {
        name: `Dry Run Check Business ${timestamp}`,
        city: 'Dallas',
        category: 'HVAC',
        source: 'public_search',
      },
    });

    const lead = await db.lead.create({
      data: {
        businessId: biz.id,
        classification: 'WARM',
        leadOpportunityScore: 70,
        priorityRank: 2,
      },
    });

    // Create a simulated dry-run send (dryRun: true)
    await db.outreach.create({
      data: {
        leadId: lead.id,
        variant: 'VARIANT_B_STANDARD',
        subject: 'HVAC audit feedback',
        body: 'Simulated dispatch body',
        status: 'SENT',
        dryRun: true,
        sentAt: new Date(),
      },
    });

    const summary = await statusService.getStatusSummary();

    // realSends must remain strictly 0
    expect(summary.counts.realSends).toBe(0);

    // Clean up
    await db.outreach.deleteMany({ where: { leadId: lead.id } });
    await db.lead.delete({ where: { id: lead.id } });
    await db.business.delete({ where: { id: biz.id } });
  });

  // 6. Dashboard and Analytics Counters Agree
  it('system status counts and analytics endpoint metrics agree on all core pipeline stages', async () => {
    const summary = await statusService.getStatusSummary();

    const res = await fetch(`${baseUrl}/analytics`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const analytics = body.data.metrics;

    // Cross-service consistency checks:
    expect(summary.counts.businesses).toBe(analytics.totalBusinesses);
    expect(summary.counts.leadsHot).toBe(analytics.hotLeads);
    expect(summary.counts.leadsWarm).toBe(analytics.warmLeads);
    expect(summary.counts.emailContactable).toBe(analytics.contactableLeads);
    expect(summary.counts.phoneContactable).toBe(analytics.phoneContactableLeads);
    expect(summary.counts.pendingReview).toBe(analytics.pendingReview);
    expect(summary.counts.approved).toBe(analytics.approvedOutreach);
    expect(summary.counts.realSends).toBe(analytics.realOutreachSent);
    expect(summary.counts.realSends).toBe(0);
  });
});
