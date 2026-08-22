import { describe, it, expect } from 'vitest';
import { RuleBasedPersonalizationProvider } from '../src/modules/personalization/providers/rule-based-personalization.provider.js';
import { LocalAIPersonalizationProvider } from '../src/modules/personalization/providers/local-ai-personalization.provider.js';
import { OutreachQualityGuard } from '../src/modules/personalization/quality-guard.js';
import { translateOpportunityFlagToBusinessLanguage } from '../src/modules/personalization/personalization-context.builder.js';
import { PersonalizationContext } from '../src/types/index.js';
import { OutreachRepository } from '../src/database/repositories/outreach.repository.js';
import { prisma } from '../src/database/index.js';

describe('Phase 6: AI Personalization & Outreach Content Engine', () => {
  const provider = new RuleBasedPersonalizationProvider();

  const mockContext: PersonalizationContext = {
    business: {
      name: 'Dallas Premier Dental',
      category: 'Dentist',
      city: 'Dallas',
      country: 'USA',
      website: 'https://dallaspremierdental.com',
      reachabilityStatus: 'WEBSITE_REACHABLE',
      confidence: 'HIGH',
    },
    audit: {
      websiteStatus: 'AUDITED',
      overallScore: 68,
      loadTimeMs: 5200,
      mobileResponsive: true,
      sslValid: true,
      hasContactForm: true,
      findings: [
        {
          category: 'performance',
          title: 'Slow Loading',
          description: 'Page load time 5.2s exceeds threshold',
          severity: 'HIGH',
          evidence: '5200ms DOM content loaded',
        },
      ],
      opportunityFlags: ['SLOW_LOADING', 'NO_CLEAR_CTA'],
      topProblems: ['Initial load time of 5.2s', 'Missing prominent click-to-call button'],
    },
    lead: {
      id: 'lead-test-uuid-1',
      leadOpportunityScore: 78,
      classification: 'HOT',
      priority: 'URGENT',
      priorityRank: 1,
      confidenceLevel: 'HIGH',
      recommendedService: 'WEBSITE_IMPROVEMENT',
      topOpportunitySignals: ['SLOW_LOADING', 'NO_CLEAR_CTA'],
      topProblems: ['Initial load time of 5.2s'],
    },
    contact: {
      value: 'frontdesk@dallaspremierdental.com',
      type: 'EMAIL',
      classification: 'BUSINESS_GENERIC',
      qualityScore: 100,
      contactName: null,
      status: 'VERIFIED_PUBLIC',
      sourceType: 'OFFICIAL_WEBSITE',
    },
    sender: {
      name: 'HASSAN RAMZAN',
      company: '',
      email: 'hassanramzan59@gmail.com',
    },
  };

  describe('Provider Abstraction & Zero-Cost Requirement', () => {
    it('should run RuleBasedPersonalizationProvider locally with 100% availability and no API keys', async () => {
      expect(await provider.isAvailable()).toBe(true);
      expect(provider.name).toBe('RuleBasedPersonalizationProvider');
    });

    it('should have optional LocalAIPersonalizationProvider that safely reports false when unconfigured', async () => {
      const localAi = new LocalAIPersonalizationProvider();
      expect(await localAi.isAvailable()).toBe(false);
    });
  });

  describe('3 Outreach Variants & Subject Line Generation', () => {
    it('should generate Variant A (Short), Variant B (Standard), and Variant C (Audit-Based) with 3 subjects', async () => {
      const result = await provider.generate(mockContext);

      expect(result.variants.length).toBe(3);

      const [varA, varB, varC] = result.variants;

      // Variant A: Short (50–80 words)
      expect(varA.variant).toBe('VARIANT_A_SHORT');
      expect(varA.subjectVariants.length).toBe(3);
      expect(varA.body).toContain('Dallas Premier Dental');
      expect(varA.body.split(/\s+/).length).toBeGreaterThanOrEqual(40);
      expect(varA.body.split(/\s+/).length).toBeLessThanOrEqual(100);

      // Variant B: Standard (80–140 words)
      expect(varB.variant).toBe('VARIANT_B_STANDARD');
      expect(varB.subjectVariants.length).toBe(3);
      expect(varB.body).toContain('Dallas Premier Dental');
      expect(varB.body.split(/\s+/).length).toBeGreaterThanOrEqual(70);

      // Variant C: Audit-Based (100–180 words)
      expect(varC.variant).toBe('VARIANT_C_AUDIT');
      expect(varC.body).toContain('5.2s');
    });
  });

  describe('Evidence Linkage & Fact Invariant (No Hallucinations)', () => {
    it('should strictly reference observed load time and avoid inventing employee count or revenue', async () => {
      const result = await provider.generate(mockContext);
      const allText = result.variants.map((v) => v.body).join('\n');

      expect(allText).toContain('5.2s');
      expect(allText).not.toMatch(/\$\d+/); // No fabricated dollar figures
      expect(allText).not.toMatch(/\d+\s+employees/); // No fabricated employee counts
      expect(allText).not.toMatch(/losing customers/i); // No fear-based spam claims
    });

    it('should translate technical audit flags into non-technical business language', () => {
      expect(translateOpportunityFlagToBusinessLanguage('SLOW_LOADING')).toBe('the site appears slower than it should be on mobile');
      expect(translateOpportunityFlagToBusinessLanguage('POOR_MOBILE')).toBe('the mobile experience could be improved');
      expect(translateOpportunityFlagToBusinessLanguage('NO_BOOKING')).toBe('there may be an opportunity to make appointment requests easier');
    });
  });

  describe('Special Case Scenarios', () => {
    it('should handle NO_WEBSITE leads by proposing web development without claiming existing site is broken', async () => {
      const noWebContext: PersonalizationContext = {
        ...mockContext,
        business: {
          ...mockContext.business,
          name: 'Oak Cliff Dental Practice',
          website: null,
        },
        audit: null,
        lead: {
          ...mockContext.lead,
          recommendedService: 'WEBSITE_REBUILD',
          topOpportunitySignals: ['NO_WEBSITE'],
        },
      };

      const result = await provider.generate(noWebContext);
      const allText = result.variants.map((v) => v.body).join('\n');

      expect(allText).toContain("couldn't identify an official website");
      expect(allText).not.toContain('Your website is outdated');
      expect(result.salesAngle.recommendedService).toBe('WEBSITE_REBUILD');
    });

    it('should handle BLOCKED websites neutrally without claiming the site has severe issues', async () => {
      const blockedContext: PersonalizationContext = {
        ...mockContext,
        audit: {
          ...mockContext.audit!,
          websiteStatus: 'BLOCKED',
        },
      };

      const result = await provider.generate(blockedContext);
      const allText = result.variants.map((v) => v.body).join('\n');

      expect(allText).not.toContain('Your website is broken');
    });

    it('should pitch MOBILE_APP only when mobileAppOpportunity is HIGH or recommended', async () => {
      const appLeadContext: PersonalizationContext = {
        ...mockContext,
        lead: {
          ...mockContext.lead,
          recommendedService: 'MOBILE_APP',
        },
        audit: {
          ...mockContext.audit!,
          mobileAppOpportunity: 'HIGH',
          mobileAppReasoning: ['Online patient booking portal active on web.'],
        },
      };

      const result = await provider.generate(appLeadContext);
      expect(result.salesAngle.recommendedService).toBe('MOBILE_APP');
      expect(result.salesAngle.opportunity).toContain('mobile app');
    });
  });

  describe('Outreach Quality Guard & Anti-Spam Filtering', () => {
    it('should pass professional, natural email copy', () => {
      const check = OutreachQualityGuard.evaluate(
        'Quick question for Dallas Premier Dental',
        'Hi there, I noticed your site takes around 5.2s to load on mobile. Would you be open to a quick breakdown?'
      );

      expect(check.passed).toBe(true);
      expect(check.warnings.length).toBe(0);
      expect(check.blockedReasons.length).toBe(0);
    });

    it('should flag and block spammy, fear-based, and manipulative claims', () => {
      const spamCheck = OutreachQualityGuard.evaluate(
        'URGENT: YOU ARE LOSING CUSTOMERS AND $10,000 PER MONTH!!!',
        'ACT NOW for 100% GUARANTEED GROWTH on Google!'
      );

      expect(spamCheck.passed).toBe(false);
      expect(spamCheck.blockedReasons.length).toBeGreaterThan(0);
      expect(spamCheck.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Database Persistence & Draft Deduplication', () => {
    it('should upsert drafts per lead variant without creating duplicate records', async () => {
      const biz = await prisma.business.create({
        data: {
          name: `Personalize Test Biz ${Date.now()}`,
          category: 'Dentist',
          city: 'Dallas',
          website: 'https://personalizetest.com',
          source: 'test',
        },
      });

      const lead = await prisma.lead.create({
        data: {
          businessId: biz.id,
          leadOpportunityScore: 82,
          overallScore: 82,
          classification: 'HOT',
          priority: 'URGENT',
          priorityRank: 1,
          recommendedService: 'WEBSITE_IMPROVEMENT',
        },
      });

      const outreachRepo = new OutreachRepository();

      const draftPayload = {
        variant: 'VARIANT_A_SHORT' as const,
        channel: 'EMAIL' as const,
        subject: 'Quick question regarding your website',
        subjectVariants: ['Subject 1', 'Subject 2', 'Subject 3'],
        body: 'Hello, this is a test draft body.',
        personalizationScore: 90,
        confidence: 'HIGH' as const,
        provider: 'RuleBasedPersonalizationProvider',
        sourceEvidence: ['5.2s load time'],
        salesAngle: {
          problem: 'Slow loading',
          evidence: ['5.2s load time'],
          opportunity: 'Optimize assets',
          recommendedService: 'WEBSITE_IMPROVEMENT' as const,
          businessImpact: 'Improves conversions',
          confidence: 'HIGH' as const,
        },
        qualityCheck: {
          passed: true,
          score: 100,
          warnings: [],
          blockedReasons: [],
        },
        status: 'DRAFT' as const,
      };

      // 1. Initial Insert
      const d1 = await outreachRepo.upsertDraft(lead.id, draftPayload);
      expect(d1.id).toBeDefined();

      const count1 = await prisma.outreach.count({ where: { leadId: lead.id } });
      expect(count1).toBe(1);

      // 2. Re-run / Update
      const d2 = await outreachRepo.upsertDraft(lead.id, {
        ...draftPayload,
        personalizationScore: 95,
      });
      expect(d2.id).toBe(d1.id);

      const count2 = await prisma.outreach.count({ where: { leadId: lead.id } });
      expect(count2).toBe(1); // Verified no duplicate draft!
    });
  });
});
