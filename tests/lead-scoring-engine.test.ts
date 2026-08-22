import { describe, it, expect, beforeEach } from 'vitest';
import { RuleBasedLeadScoringProvider } from '../src/modules/scoring/rule-based-scoring.provider.js';
import { analyzeCommercialPotential } from '../src/modules/scoring/analyzers/commercial-potential.analyzer.js';
import { analyzeContactability } from '../src/modules/scoring/analyzers/contactability.analyzer.js';
import { analyzeProblemSeverity } from '../src/modules/scoring/analyzers/problem-severity.analyzer.js';
import { recommendService } from '../src/modules/scoring/analyzers/service-recommender.js';
import { generateSalesAngle } from '../src/modules/scoring/analyzers/sales-angle-generator.js';
import { LeadScoringService } from '../src/modules/scoring/lead-scoring.service.js';
import { prisma } from '../src/database/index.js';

describe('Phase 4: Multi-Factor Lead Scoring & Prioritization', () => {
  const scorer = new RuleBasedLeadScoringProvider();

  describe('Commercial Potential Analyzer', () => {
    it('should assign high commercial potential to high-ticket niches with operational signals', () => {
      const result = analyzeCommercialPotential({
        category: 'Dentist',
        hasPhone: true,
        hasAddress: true,
        hasBookingOrOrdering: true,
      });

      expect(result.score).toBeGreaterThanOrEqual(85);
      expect(result.reasoning.some((r) => r.includes('High-ticket commercial vertical'))).toBe(true);
    });

    it('should assign lower baseline to general low-ticket categories without operational signals', () => {
      const result = analyzeCommercialPotential({
        category: 'Hobby Blog',
        hasPhone: false,
        hasAddress: false,
        hasBookingOrOrdering: false,
      });

      expect(result.score).toBeLessThanOrEqual(45);
    });
  });

  describe('Contactability Analyzer', () => {
    it('should reward multiple reachable sales channels, heavily weighting email and phone', () => {
      const fullContact = analyzeContactability({
        hasEmail: true,
        hasPhone: true,
        hasWebsite: true,
        hasContactForm: true,
        hasAddress: true,
      });
      expect(fullContact.score).toBe(100);
      expect(fullContact.channelsAvailable).toContain('Email');
      expect(fullContact.channelsAvailable).toContain('Phone');

      const phoneOnly = analyzeContactability({
        hasEmail: false,
        hasPhone: true,
        hasWebsite: false,
        hasContactForm: false,
        hasAddress: false,
      });
      expect(phoneOnly.score).toBe(25);
      expect(phoneOnly.channelsAvailable).toEqual(['Phone']);
    });
  });

  describe('Problem Severity Analyzer', () => {
    it('should score CRITICAL severity for missing website or broken mobile layout', () => {
      const noSite = analyzeProblemSeverity({
        hasNoWebsite: true,
        opportunityFlags: ['NO_WEBSITE'],
        findingsTitles: ['No website registered'],
      });
      expect(noSite.score).toBeGreaterThanOrEqual(85);
      expect(noSite.criticalProblems.length).toBeGreaterThan(0);

      const poorMobile = analyzeProblemSeverity({
        hasNoWebsite: false,
        opportunityFlags: ['POOR_MOBILE', 'SLOW_LOADING'],
        findingsTitles: ['Horizontal Layout Overflow'],
      });
      expect(poorMobile.score).toBeGreaterThanOrEqual(50);
      expect(poorMobile.criticalProblems.length).toBeGreaterThan(0);
    });
  });

  describe('Service Recommender & Sales Angle', () => {
    it('should recommend WEBSITE_REBUILD for businesses without a website', () => {
      const recommendation = recommendService({
        hasNoWebsite: true,
        websiteQualityScore: 0,
        opportunityFlags: ['NO_WEBSITE'],
        mobileAppOpportunity: 'LOW',
        topProblems: ['No website found'],
      });

      expect(recommendation.service).toBe('WEBSITE_REBUILD');

      const salesAngle = generateSalesAngle({
        businessName: 'Dallas Smile Center',
        category: 'Dentist',
        hasNoWebsite: true,
        websiteQualityScore: 0,
        opportunityFlags: ['NO_WEBSITE'],
        recommendedService: recommendation.service,
        topProblems: ['No website found'],
      });

      expect(salesAngle.recommendedService).toBe('WEBSITE_REBUILD');
      expect(salesAngle.problem).toContain('No online website presence');
    });

    it('should recommend MOBILE_APP for high-quality websites with booking/ordering workflows', () => {
      const recommendation = recommendService({
        hasNoWebsite: false,
        websiteQualityScore: 88,
        opportunityFlags: [],
        mobileAppOpportunity: 'HIGH',
        topProblems: [],
      });

      expect(recommendation.service).toBe('MOBILE_APP');

      const salesAngle = generateSalesAngle({
        businessName: 'Metro Dental Spa',
        category: 'Dentist',
        hasNoWebsite: false,
        websiteQualityScore: 88,
        opportunityFlags: [],
        recommendedService: recommendation.service,
        topProblems: [],
      });

      expect(salesAngle.recommendedService).toBe('MOBILE_APP');
      expect(salesAngle.opportunity).toContain('mobile app');
    });

    it('should recommend MOBILE_OPTIMIZATION for websites with broken mobile layout', () => {
      const recommendation = recommendService({
        hasNoWebsite: false,
        websiteQualityScore: 60,
        opportunityFlags: ['POOR_MOBILE'],
        mobileAppOpportunity: 'LOW',
        topProblems: ['Horizontal Layout Overflow'],
      });

      expect(recommendation.service).toBe('MOBILE_OPTIMIZATION');
    });
  });

  describe('Website Quality vs Lead Opportunity Separation (Critical Business Logic)', () => {
    it('MUST rank Case B (Quality=55, Opportunity=90) above Case A (Quality=90, Opportunity=35)', () => {
      // Case A: High quality website, few weaknesses, lower development opportunity
      const caseA = scorer.calculateScore({
        business: {
          name: 'Pristine Dental Care',
          category: 'Dentist',
          city: 'Dallas',
          phone: '+1 214-555-1111',
          website: 'https://pristinedental.com',
          officialWebsiteConfidence: 'HIGH',
        },
        audit: {
          website: 'https://pristinedental.com',
          status: 'AUDITED',
          score: 90, // High website quality
          performanceScore: 90,
          mobileResponsive: true,
          sslValid: true,
          hasContactForm: true,
          loadTimeMs: 1200,
          issues: [],
        },
        contacts: [{ email: 'info@pristinedental.com', source: 'website' }],
      });

      // Case B: Flawed/broken website in high-ticket vertical, high development opportunity
      const caseB = scorer.calculateScore({
        business: {
          name: 'Dallas Emergency Dental Clinic',
          category: 'Dentist',
          city: 'Dallas',
          phone: '+1 214-555-2222',
          website: 'https://dallasemergencydental.com',
          officialWebsiteConfidence: 'HIGH',
        },
        audit: {
          website: 'https://dallasemergencydental.com',
          status: 'AUDITED',
          score: 45, // Poor website quality
          performanceScore: 35,
          mobileResponsive: false,
          sslValid: false,
          hasContactForm: false,
          loadTimeMs: 5800,
          issues: ['Horizontal Layout Overflow', 'Insecure HTTP', 'Slow Loading'],
        },
        contacts: [{ email: 'contact@dallasemergencydental.com', source: 'website' }],
      });

      // Assert Lead Opportunity Score distinction
      expect(caseB.leadOpportunityScore).toBeGreaterThan(caseA.leadOpportunityScore);
      expect(caseB.priorityRank).toBeLessThanOrEqual(caseA.priorityRank); // Lower rank number = Higher priority
      expect(caseB.classification).toBe('HOT');
    });
  });

  describe('Lead Scoring Service & Database Deduplication', () => {
    it('should score and persist a lead, and update the existing lead on rescore without creating duplicates', async () => {
      const biz = await prisma.business.create({
        data: {
          name: `Scoring Test Clinic ${Date.now()}`,
          category: 'Dentist',
          city: 'Dallas',
          phone: '+1 214-555-9999',
          website: 'https://rescoretestdental.com',
          source: 'test',
        },
      });

      await prisma.websiteAudit.create({
        data: {
          businessId: biz.id,
          website: 'https://rescoretestdental.com',
          status: 'AUDITED',
          score: 50,
          technicalScore: 60,
          mobileScore: 40,
          performanceScore: 40,
          seoScore: 60,
          accessibilityScore: 50,
          uxScore: 40,
          contentScore: 60,
          opportunityFlags: JSON.stringify(['POOR_MOBILE', 'SLOW_LOADING']),
          issuesJson: JSON.stringify(['Horizontal Layout Overflow', 'Slow initial response']),
        },
      });

      const service = new LeadScoringService();

      // 1. First scoring run
      const firstScore = await service.scoreBusinessById(biz.id);
      expect(firstScore.leadOpportunityScore).toBeGreaterThanOrEqual(60);

      const leadsCountFirst = await prisma.lead.count({
        where: { businessId: biz.id },
      });
      expect(leadsCountFirst).toBe(1);

      // 2. Second scoring run (rescore)
      const secondScore = await service.scoreBusinessById(biz.id);
      expect(secondScore.leadOpportunityScore).toBe(firstScore.leadOpportunityScore);

      const leadsCountSecond = await prisma.lead.count({
        where: { businessId: biz.id },
      });
      expect(leadsCountSecond).toBe(1); // Verified no duplicate lead created!
    });
  });
});
