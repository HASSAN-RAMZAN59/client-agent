import { describe, it, expect, beforeEach } from 'vitest';
import { campaignService } from '../src/modules/campaigns/campaign.service.js';
import { campaignRepository } from '../src/database/repositories/campaign.repository.js';
import { funnelAnalyticsService } from '../src/modules/campaigns/funnel-analytics.service.js';
import { marketIntelligenceService } from '../src/modules/campaigns/market-intelligence.service.js';
import { queueService } from '../src/modules/campaigns/queue.service.js';
import { safetyControls } from '../src/config/safety.js';

describe('Phase 9: Production Lead Generation & Conversion Workflow', () => {
  const testCampaignName = `US-DALLAS-DENTISTS-${Date.now()}`;
  let createdCampaignId: string;

  describe('1. Campaign Configuration & Persistence', () => {
    it('should create and persist a new client acquisition campaign in SQLite', async () => {
      const campaign = await campaignService.createCampaign({
        name: testCampaignName,
        country: 'US',
        state: 'TX',
        city: 'Dallas',
        niche: 'Dentist',
        targetBusinesses: 100,
        minLeadScore: 60.0,
        preferredService: 'WEBSITE_REBUILD',
        maxDiscoveryPerRun: 10,
        maxEmailsPerDay: 20,
      });

      expect(campaign).toBeDefined();
      expect(campaign.id).toBeDefined();
      expect(campaign.name).toBe(testCampaignName);
      expect(campaign.city).toBe('Dallas');
      expect(campaign.country).toBe('US');
      expect(campaign.targetBusinesses).toBe(100);
      expect(campaign.status).toBe('ACTIVE');

      createdCampaignId = campaign.id;
    });

    it('should retrieve the persisted campaign by ID and by Name', async () => {
      const byId = await campaignRepository.getCampaignById(createdCampaignId);
      expect(byId).not.toBeNull();
      expect(byId?.name).toBe(testCampaignName);

      const byName = await campaignRepository.getCampaignByName(testCampaignName);
      expect(byName).not.toBeNull();
      expect(byName?.id).toBe(createdCampaignId);
    });

    it('should list configured campaigns', async () => {
      const list = await campaignService.listCampaigns();
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.some((c) => c.id === createdCampaignId)).toBe(true);
    });
  });

  describe('2. Campaign-Specific Pipeline Execution', () => {
    it('should execute isolated end-to-end pipeline in mock mode without errors', async () => {
      const runResult = await campaignService.runCampaignPipeline(createdCampaignId, {
        mock: true,
        maxItems: 4,
      });

      expect(runResult).toBeDefined();
      expect(runResult.campaignId).toBe(createdCampaignId);
      expect(runResult.discovered).toBeGreaterThanOrEqual(1);
      expect(runResult.leadsScored).toBeGreaterThanOrEqual(1);
      expect(runResult.draftsGenerated).toBeGreaterThanOrEqual(1);
    });
  });

  describe('3. Stage-by-Stage Funnel Analytics & Bottleneck Identification', () => {
    it('should compute complete conversion funnel and drop-off percentages', async () => {
      const funnel = await funnelAnalyticsService.getCampaignFunnel(createdCampaignId);

      expect(funnel).toBeDefined();
      expect(funnel.campaignId).toBe(createdCampaignId);
      expect(funnel.stages.length).toBe(11);

      // Verify essential stage names
      const stageNames = funnel.stages.map((s) => s.stage);
      expect(stageNames).toContain('RAW DISCOVERED');
      expect(stageNames).toContain('UNIQUE BUSINESSES');
      expect(stageNames).toContain('WEBSITE AVAILABLE');
      expect(stageNames).toContain('QUALIFIED');
      expect(stageNames).toContain('CONTACTABLE');
      expect(stageNames).toContain('PERSONALIZED');
      expect(stageNames).toContain('REVIEWED');
      expect(stageNames).toContain('APPROVED');
      expect(stageNames).toContain('READY TO SEND');
      expect(stageNames).toContain('SENT');

      // Verify metrics properties
      for (const st of funnel.stages) {
        expect(typeof st.count).toBe('number');
        expect(typeof st.percentage).toBe('number');
        expect(typeof st.conversionFromPrevious).toBe('number');
        expect(typeof st.dropOffCount).toBe('number');
        expect(typeof st.dropOffPercentage).toBe('number');
      }

      expect(funnel.bottleneckStage).toBeDefined();
      expect(funnel.bottleneckReason).toBeDefined();
    });
  });

  describe('4. Daily Lead Target & Velocity Pacing', () => {
    it('should compute campaign pacing, remaining leads, and completion projections', async () => {
      const pacing = await campaignService.calculatePacing(createdCampaignId);

      expect(pacing).toBeDefined();
      expect(pacing.targetTotal).toBe(100);
      expect(typeof pacing.achieved).toBe('number');
      expect(typeof pacing.remaining).toBe('number');
      expect(typeof pacing.avgPerDayRequired).toBe('number');
      expect(typeof pacing.currentAvgPerDay).toBe('number');
      expect(typeof pacing.onTrack).toBe('boolean');
    });
  });

  describe('5. Prioritized Lead Queue Ordering', () => {
    it('should return prioritized leads ordered by Score, Contact Quality, and Problem Severity', async () => {
      const queue = await queueService.getLeadQueue({ limit: 10 });

      expect(Array.isArray(queue)).toBe(true);
      if (queue.length > 1) {
        for (let i = 0; i < queue.length - 1; i++) {
          const current = queue[i]!;
          const next = queue[i + 1]!;
          // Top ordering must be by leadScore descending or contact quality
          expect(current.leadScore).toBeGreaterThanOrEqual(next.leadScore);
        }
      }
    });

    it('should filter queue by city and niche without error', async () => {
      const dallasDentists = await queueService.getLeadQueue({
        city: 'Dallas',
        niche: 'Dentist',
        limit: 5,
      });

      expect(Array.isArray(dallasDentists)).toBe(true);
      for (const item of dallasDentists) {
        expect(item.city.toLowerCase()).toContain('dallas');
      }
    });
  });

  describe('6. Actionable Human Review Queue', () => {
    it('should return pending drafts requiring human review with full sales context', async () => {
      const reviewItems = await queueService.getReviewQueue(10);

      expect(Array.isArray(reviewItems)).toBe(true);
      for (const item of reviewItems) {
        expect(item.outreachId).toBeDefined();
        expect(item.businessName).toBeDefined();
        expect(item.subject).toBeDefined();
        expect(item.bodyPreview).toBeDefined();
        expect(item.qualityScore).toBeGreaterThanOrEqual(0);
        expect(item.status).toMatch(/DRAFT|REVIEW_REQUIRED/);
      }
    });
  });

  describe('7. Market Performance & Service Opportunity Demand', () => {
    it('should compute market performance metrics across regions', async () => {
      const markets = await marketIntelligenceService.getMarketPerformance();

      expect(Array.isArray(markets)).toBe(true);
      for (const m of markets) {
        expect(m.market).toBeDefined();
        expect(m.discoveredTotal).toBeGreaterThanOrEqual(0);
        expect(typeof m.qualificationRate).toBe('number');
        expect(typeof m.contactRate).toBe('number');
      }
    });

    it('should compute service opportunity demand breakdown across all core services', async () => {
      const services = await marketIntelligenceService.getServiceDemandBreakdown();

      expect(Array.isArray(services)).toBe(true);
      const serviceNames = services.map((s) => s.service);
      expect(serviceNames).toContain('WEBSITE_REBUILD');
      expect(serviceNames).toContain('WEBSITE_IMPROVEMENT');
      expect(serviceNames).toContain('MOBILE_OPTIMIZATION');
      expect(serviceNames).toContain('MOBILE_APP');
      expect(serviceNames).toContain('SEO_IMPROVEMENT');
      expect(serviceNames).toContain('MAINTENANCE');
    });
  });

  describe('8. Hard Safety Invariants', () => {
    it('should strictly maintain DRY_RUN=true and OUTREACH_ENABLED=false', async () => {
      const { config } = await import('../src/config/env.js');
      const policy = safetyControls.getPolicy();
      expect(policy.isDryRun).toBe(true);
      expect(config.OUTREACH_ENABLED).toBe(false);
    });
  });
});
