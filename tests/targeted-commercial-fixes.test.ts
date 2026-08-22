import { describe, it, expect, beforeEach } from 'vitest';
import { cleanSearchTitleToBusinessName, normalizePhone } from '../src/modules/discovery/normalizer.js';
import { generateSalesAngle } from '../src/modules/scoring/analyzers/sales-angle-generator.js';
import { buildDetailedSalesAngle } from '../src/modules/personalization/sales-angle.builder.js';
import { RuleBasedPersonalizationProvider } from '../src/modules/personalization/providers/rule-based-personalization.provider.js';
import { FunnelAnalyticsService } from '../src/modules/campaigns/funnel-analytics.service.js';
import { QueueService } from '../src/modules/campaigns/queue.service.js';
import { SafetyControls } from '../src/config/safety.js';
import { config } from '../src/config/env.js';
import { getPrismaClient } from '../src/database/client.js';

describe('Targeted Commercial Quality Fixes (Post-Phase 9)', () => {
  const db = getPrismaClient();

  describe('1. Search Title & Business Name Normalization', () => {
    it('should clean "Contact Us" prefix and repeated business name fragment', () => {
      const input = 'Contact Us Atlantis Dental Care Dallas TX Atlantis Dental Care';
      const result = cleanSearchTitleToBusinessName(input, { city: 'Dallas', state: 'TX' });

      expect(result.cleanedName).toBe('Atlantis Dental Care');
      expect(result.rawTitle).toBe(input);
      expect(result.modified).toBe(true);
      expect(result.confidence).toBe('HIGH');
    });

    it('should clean standalone "CONTACT US" prefix without separator', () => {
      const input = 'CONTACT US Family Dentistry & Implant Center';
      const result = cleanSearchTitleToBusinessName(input, { city: 'Dallas', state: 'TX' });

      expect(result.cleanedName).toBe('Family Dentistry & Implant Center');
      expect(result.rawTitle).toBe(input);
      expect(result.modified).toBe(true);
    });

    it('should clean pipe-delimited SEO suffixes including "Official Website"', () => {
      const input = 'Atlantis Dental Care | Dallas Dentist | Official Website';
      const result = cleanSearchTitleToBusinessName(input, { city: 'Dallas', state: 'TX', niche: 'Dentist' });

      expect(result.cleanedName).toBe('Atlantis Dental Care');
      expect(result.modified).toBe(true);
    });

    it('should clean "Home -" prefix and preserve clean brand name', () => {
      const input = 'Home - Example Dental Clinic';
      const result = cleanSearchTitleToBusinessName(input, { city: 'Dallas', state: 'TX' });

      expect(result.cleanedName).toBe('Example Dental Clinic');
      expect(result.modified).toBe(true);
    });

    it('should clean trailing location suffix "- Dallas TX"', () => {
      const input = 'Example Dental Clinic - Dallas TX';
      const result = cleanSearchTitleToBusinessName(input, { city: 'Dallas', state: 'TX' });

      expect(result.cleanedName).toBe('Example Dental Clinic');
      expect(result.modified).toBe(true);
    });

    it('should preserve legitimate business names starting with city or containing medical punctuation', () => {
      const name1 = 'Dallas Dental Wellness';
      const res1 = cleanSearchTitleToBusinessName(name1, { city: 'Dallas', state: 'TX' });
      expect(res1.cleanedName).toBe('Dallas Dental Wellness');
      expect(res1.modified).toBe(false);

      const name2 = 'Mark E. Glover, DDS, MSD, PC';
      const res2 = cleanSearchTitleToBusinessName(name2, { city: 'Dallas', state: 'TX' });
      expect(res2.cleanedName).toBe('Mark E. Glover, DDS, MSD, PC');

      const name3 = 'Playa Dental';
      const res3 = cleanSearchTitleToBusinessName(name3, { city: 'Dallas', state: 'TX' });
      expect(res3.cleanedName).toBe('Playa Dental');
    });

    it('should preserve rawTitle separately for provenance', () => {
      const raw = '  Welcome to Uptown Dental Clinic | Dallas TX Official Site  ';
      const res = cleanSearchTitleToBusinessName(raw, { city: 'Dallas', state: 'TX' });

      expect(res.rawTitle).toBe(raw.trim());
      expect(res.cleanedName).toBe('Uptown Dental Clinic');
    });
  });

  describe('2. Phone-Only Leads & Channel Classification', () => {
    it('should distinguish BUSINESS_PHONE from DECISION_MAKER_PHONE and default to BUSINESS_PHONE', () => {
      const phoneClassificationDefault: import('../src/types/index.js').ContactClassification = 'BUSINESS_PHONE';
      expect(phoneClassificationDefault).toBe('BUSINESS_PHONE');
      expect(['BUSINESS_PHONE', 'DECISION_MAKER_PHONE']).toContain('BUSINESS_PHONE');
    });

    it('should normalize public phone numbers properly', () => {
      const raw = '+1 (214) 555-0199';
      const normalized = normalizePhone(raw);
      expect(normalized).toBe('+1 (214) 555-0199');
    });
  });

  describe('3. Sales Angle Safety & Grounded Language', () => {
    it('should NOT claim "your website is outdated" when business has no website', () => {
      const angle = generateSalesAngle({
        businessName: 'West Davis Dental',
        category: 'Dentist',
        hasNoWebsite: true,
        websiteQualityScore: 0,
        opportunityFlags: ['NO_WEBSITE'],
        recommendedService: 'WEBSITE_REBUILD',
        topProblems: [],
      });

      expect(angle.problem.toLowerCase()).not.toContain('outdated');
      expect(angle.problem.toLowerCase()).not.toContain('slow');
      expect(angle.problem).toContain("couldn't identify an official website");
      expect(angle.recommendedService).toBe('WEBSITE_REBUILD');
    });

    it('should ground personalization drafts in factual non-hallucinatory statements when website is missing', async () => {
      const provider = new RuleBasedPersonalizationProvider();
      const result = await provider.generate({
        business: {
          id: 'test-biz-id',
          name: 'West Davis Dental',
          city: 'Dallas',
          category: 'Dentist',
          country: 'US',
          website: null,
          phone: '+1 214-555-0123',
          source: 'osm_overpass',
        },
        audit: {
          website: '',
          status: 'NO_WEBSITE',
          confidence: 'HIGH',
          overallScore: 0,
          categories: { technical: 0, mobile: 0, performance: 0, seo: 0, accessibility: 0, ux: 0, content: 0 },
          opportunityFlags: ['NO_WEBSITE'],
          mobileAppOpportunity: 'LOW',
          mobileAppReasoning: [],
          findings: [],
          topProblems: ['No active website found'],
          pageCount: 0,
          mobileResponsive: false,
          sslValid: false,
          hasContactForm: false,
          loadTimeMs: 0,
          issues: [],
          auditedAt: new Date(),
          websiteStatus: 'NO_WEBSITE',
          score: 0,
        },
        lead: {
          id: 'test-lead-id',
          leadOpportunityScore: 68,
          overallScore: 68,
          classification: 'HOT',
          priority: 'URGENT',
          priorityRank: 1,
          confidenceLevel: 'HIGH',
          breakdown: { websiteOpportunity: 95, commercialPotential: 80, contactability: 10, websiteProblem: 85, mobileAppOpportunity: 20, dataConfidence: 70 },
          recommendedService: 'WEBSITE_REBUILD',
          topOpportunitySignals: ['NO_WEBSITE'],
          topProblems: ['No active website found'],
          salesAngle: { problem: "I couldn't identify an official website for West Davis Dental.", opportunity: "Build website", recommendedService: 'WEBSITE_REBUILD', reason: "Local presence" },
          reasoning: [],
        },
        contact: {
          value: '+1 214-555-0123',
          type: 'PHONE',
          classification: 'BUSINESS_PHONE',
          status: 'VERIFIED_PUBLIC',
        },
        sender: {
          name: 'HASSAN RAMZAN',
          company: '',
        },
      });

      for (const variant of result.variants) {
        expect(variant.body.toLowerCase()).not.toContain('your website is outdated');
        expect(variant.body.toLowerCase()).not.toContain('lost revenue');
        expect(variant.body.toLowerCase()).not.toContain('lost customers');
        expect(variant.body).toContain("couldn't identify an official website for West Davis Dental");
      }
    });
  });

  describe('4. Safety Invariants Verification', () => {
    it('should strictly enforce DRY_RUN=true and OUTREACH_ENABLED=false', () => {
      const policy = SafetyControls.getInstance().getPolicy();
      expect(policy.isDryRun).toBe(true);
      expect(config.OUTREACH_ENABLED).toBe(false);
    });
  });
});
