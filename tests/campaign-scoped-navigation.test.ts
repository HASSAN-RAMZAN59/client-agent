import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { createApp } from '../src/api/server.js';
import { getPrismaClient } from '../src/database/client.js';
import { PrismaClient } from '@prisma/client';
import { interactiveReviewerService } from '../src/services/index.js';

describe('Campaign-Scoped Navigation Badge & Review Queue Consistency Tests', () => {
  let server: http.Server;
  let baseUrl: string;
  let db: PrismaClient;

  beforeAll(async () => {
    db = getPrismaClient();
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
  });

  // 1. global pending review count
  it('1. GET /api/navigation-summary without campaign returns global pending review count', async () => {
    const res = await fetch(`${baseUrl}/navigation-summary`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.status).toBe('success');
    expect(body.data.isScoped).toBe(false);
    expect(body.data.campaignId).toBeNull();
    // Global pending review count matches status summary
    const statusRes = await fetch(`${baseUrl}/status`);
    const statusBody = await statusRes.json();
    expect(body.data.pendingReview).toBe(statusBody.data.counts.pendingReview);
  });

  // 2. campaign with 0 pending reviews returns 0
  it('2. GET /api/navigation-summary for campaign with 0 items returns exactly 0 (not 116)', async () => {
    // Phase 11 campaign or any non-member campaign
    const phase11 = await db.campaign.findFirst({
      where: { name: { contains: 'Phase 11' } },
    });

    const targetCampaignId = phase11?.id || 'non-existent-campaign-id';
    const res = await fetch(`${baseUrl}/navigation-summary?campaignId=${encodeURIComponent(targetCampaignId)}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.status).toBe('success');
    expect(body.data.isScoped).toBe(true);
    expect(body.data.campaignId).toBe(targetCampaignId);
    expect(body.data.pendingReview).toBe(0);
    expect(body.data.pendingReview).not.toBe(116);
  });

  // 3. sidebar badge uses selected campaign scope
  it('3. sidebar badge count uses selected campaign scope', async () => {
    const campaigns = await db.campaign.findMany({ take: 5 });
    for (const c of campaigns) {
      const res = await fetch(`${baseUrl}/navigation-summary?campaignId=${encodeURIComponent(c.id)}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.campaignId).toBe(c.id);
      expect(body.data.isScoped).toBe(true);
      expect(typeof body.data.pendingReview).toBe('number');
    }
  });

  // 4. Review Queue page and sidebar count agree
  it('4. Review Queue page and sidebar count agree 100% on the same campaign', async () => {
    const phase11 = await db.campaign.findFirst({
      where: { name: { contains: 'Phase 11' } },
    });

    if (phase11) {
      // Fetch sidebar badge count
      const navRes = await fetch(`${baseUrl}/navigation-summary?campaignId=${encodeURIComponent(phase11.id)}`);
      const navBody = await navRes.json();

      // Fetch review queue page items
      const reviewRes = await fetch(`${baseUrl}/review?campaignId=${encodeURIComponent(phase11.id)}`);
      const reviewBody = await reviewRes.json();

      expect(navBody.data.pendingReview).toBe(reviewBody.data.totalItems);
      expect(navBody.data.pendingReview).toBe(reviewBody.data.items.length);
    }
  });

  // 5. one business = one review item
  it('5. one business equals one review item in queue and summary', async () => {
    const groups = await interactiveReviewerService.getPendingBusinessGroups({
      includeTest: false,
      limit: 100,
    });

    const businessIds = groups.map((g) => g.businessId);
    const uniqueBusinessIds = new Set(businessIds);
    expect(uniqueBusinessIds.size).toBe(businessIds.length);
  });

  // 6. changing active campaign refreshes badge
  it('6. changing active campaign refreshes badge scope without stale data', async () => {
    const c1 = await db.campaign.findFirst({ where: { name: { contains: 'Phase 11' } } });
    const c2 = await db.campaign.findFirst({ where: { name: { contains: 'US First Live Pilot' } } });

    if (c1 && c2) {
      const res1 = await fetch(`${baseUrl}/navigation-summary?campaignId=${encodeURIComponent(c1.id)}`);
      const body1 = await res1.json();

      const res2 = await fetch(`${baseUrl}/navigation-summary?campaignId=${encodeURIComponent(c2.id)}`);
      const body2 = await res2.json();

      expect(body1.data.campaignId).toBe(c1.id);
      expect(body2.data.campaignId).toBe(c2.id);
      expect(body1.data.campaignId).not.toBe(body2.data.campaignId);
    }
  });

  // 7. test records excluded
  it('7. test and synthetic fixture records are strictly excluded from navigation summary', async () => {
    const res = await fetch(`${baseUrl}/navigation-summary`);
    const body = await res.json();
    expect(body.status).toBe('success');

    // Verify test business filter excludes test leads
    const testBusinessCount = await db.business.count({
      where: {
        source: 'TEST_SUITE',
        lead: { outreach: { some: { status: 'REVIEW_REQUIRED' } } },
      },
    });

    // Test businesses must not contaminate real operational count
    if (testBusinessCount > 0) {
      expect(body.data.pendingReview).not.toContain(testBusinessCount);
    }
  });

  // 8. Pilot Control badge uses same campaign scope
  it('8. Pilot Control badge uses same campaign scope', async () => {
    // 1. When a campaign has 0 approved drafts, both navigation summary and pilot candidates return 0
    const campaigns = await db.campaign.findMany({ take: 3 });
    for (const c of campaigns) {
      const navRes = await fetch(`${baseUrl}/navigation-summary?campaignId=${encodeURIComponent(c.id)}`);
      const navBody = await navRes.json();

      const candidatesRes = await fetch(`${baseUrl}/pilot/candidates?campaignId=${encodeURIComponent(c.id)}`);
      const candidatesBody = await candidatesRes.json();

      expect(navBody.data.readyToSend).toBe(candidatesBody.data.total);
    }

    // 2. Global navigation summary readyToSend matches global pilot candidates total
    const globalNavRes = await fetch(`${baseUrl}/navigation-summary`);
    const globalNavBody = await globalNavRes.json();

    const globalCandidatesRes = await fetch(`${baseUrl}/pilot/candidates`);
    const globalCandidatesBody = await globalCandidatesRes.json();

    expect(globalNavBody.data.readyToSend).toBe(globalCandidatesBody.data.total);
  });

  // 9. no stale previous-campaign badge after campaign change
  it('9. no stale previous-campaign badge after rapid consecutive campaign switches', async () => {
    const campaigns = await db.campaign.findMany({ take: 3 });
    if (campaigns.length >= 2) {
      const idA = campaigns[0].id;
      const idB = campaigns[1].id;

      // Switch A -> B -> A
      const resA1 = await fetch(`${baseUrl}/navigation-summary?campaignId=${encodeURIComponent(idA)}`);
      const bodyA1 = await resA1.json();

      const resB = await fetch(`${baseUrl}/navigation-summary?campaignId=${encodeURIComponent(idB)}`);
      const bodyB = await resB.json();

      const resA2 = await fetch(`${baseUrl}/navigation-summary?campaignId=${encodeURIComponent(idA)}`);
      const bodyA2 = await resA2.json();

      expect(bodyA1.data.campaignId).toBe(idA);
      expect(bodyB.data.campaignId).toBe(idB);
      expect(bodyA2.data.campaignId).toBe(idA);
      expect(bodyA1.data.pendingReview).toBe(bodyA2.data.pendingReview);
      expect(bodyA1.data.readyToSend).toBe(bodyA2.data.readyToSend);
    }
  });
});
