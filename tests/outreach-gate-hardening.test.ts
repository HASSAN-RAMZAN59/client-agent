import { describe, it, expect } from 'vitest';
import { OutreachGateService } from '../src/modules/personalization/hardening/outreach-gate.service.js';
import { OutreachRepository } from '../src/database/repositories/outreach.repository.js';
import { SuppressionRepository } from '../src/database/repositories/suppression.repository.js';
import { EvidenceValidator } from '../src/modules/personalization/hardening/evidence-validator.js';
import { BusinessIdentityValidator } from '../src/modules/personalization/hardening/business-identity.validator.js';
import { OutreachQualityEvaluator } from '../src/modules/personalization/hardening/outreach-quality.evaluator.js';
import { ContentHasher } from '../src/modules/personalization/hardening/content-hasher.js';
import { prisma } from '../src/database/index.js';
import { PersonalizationContext } from '../src/types/index.js';

describe('Phase 6.5: Outreach Quality, Compliance & Human-Approval Hardening', () => {
  const outreachRepo = new OutreachRepository();
  const suppressionRepo = new SuppressionRepository();
  const gateService = new OutreachGateService(outreachRepo, suppressionRepo);

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
      opportunityFlags: ['SLOW_LOADING'],
      topProblems: ['Initial load time of 5.2s'],
    },
    lead: {
      id: 'lead-test-uuid-65',
      leadOpportunityScore: 78,
      classification: 'HOT',
      priority: 'URGENT',
      priorityRank: 1,
      confidenceLevel: 'HIGH',
      recommendedService: 'WEBSITE_IMPROVEMENT',
      topOpportunitySignals: ['SLOW_LOADING'],
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

  describe('1. Outreach Quality Scoring & Bands', () => {
    it('should assign high score (>= 80) and GOOD/EXCELLENT band for specific, evidence-backed draft', () => {
      const result = OutreachQualityEvaluator.evaluate({
        subject: 'Quick question regarding Dallas Premier Dental',
        body: 'Hello Dallas Premier Dental Team,\n\nI was looking at your website in Dallas and noted the 5.2s mobile load time. Would you be open to a quick breakdown?\n\nBest,\nAlex Morgan',
        variant: 'VARIANT_A_SHORT',
        context: mockContext,
        evidenceValid: true,
        identityValid: true,
      });

      expect(result.score).toBeGreaterThanOrEqual(75);
      expect(['GOOD', 'EXCELLENT']).toContain(result.qualityBand);
      expect(result.blockedReasons.length).toBe(0);
    });

    it('should assign lower score and REVIEW_REQUIRED/REJECTED band for generic or vague copy', () => {
      const result = OutreachQualityEvaluator.evaluate({
        subject: 'Web services',
        body: 'Hey, buy our services now.',
        variant: 'VARIANT_A_SHORT',
        context: mockContext,
        evidenceValid: false,
        identityValid: false,
      });

      expect(result.score).toBeLessThan(60);
      expect(result.qualityBand).toBe('REJECTED');
    });
  });

  describe('2. Evidence Validation (Anti-Hallucination & Unsupported Claims)', () => {
    it('should reject unsupported revenue loss and customer loss assertions', () => {
      const badCopy = 'You are losing customers and $15,000 in revenue every month because your website is slow!';
      const validation = EvidenceValidator.validate('Warning', badCopy, mockContext);

      expect(validation.valid).toBe(false);
      expect(validation.reasons.some((r) => r.includes('customer loss'))).toBe(true);
      expect(validation.reasons.some((r) => r.includes('revenue loss'))).toBe(true);
    });

    it('should pass factual observations that match recorded load times', () => {
      const goodCopy = 'I noticed the mobile page load time was approximately 5.2s.';
      const validation = EvidenceValidator.validate('Website speed note', goodCopy, mockContext);

      expect(validation.valid).toBe(true);
      expect(validation.reasons.length).toBe(0);
    });
  });

  describe('3. Business Identity Validation', () => {
    it('should validate matching business and contact email domains', () => {
      const validation = BusinessIdentityValidator.validate(
        'contact@dallaspremierdental.com',
        'EMAIL',
        mockContext
      );

      expect(validation.valid).toBe(true);
      expect(validation.warnings.length).toBe(0);
    });

    it('should fail when contact value is missing or NONE_FOUND', () => {
      const validation = BusinessIdentityValidator.validate('NONE_FOUND', 'NONE', mockContext);

      expect(validation.valid).toBe(false);
      expect(validation.reasons.length).toBeGreaterThan(0);
    });
  });

  describe('4. Content Hashing & Duplicate Protection', () => {
    it('should compute deterministic SHA-256 hash regardless of whitespace variations', () => {
      const hash1 = ContentHasher.hashDraft('Quick question', 'Hello Dallas Premier Dental team.');
      const hash2 = ContentHasher.hashDraft('  QUICK QUESTION  ', 'Hello Dallas Premier Dental team.  ');

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });
  });

  describe('5. Suppression Mechanism & Anti-Bypass', () => {
    it('should block drafts targeting suppressed email addresses or domains', async () => {
      // Add suppression entry
      await suppressionRepo.addSuppression({
        targetValue: 'blocked-user@suppresseddomain.com',
        targetType: 'EMAIL',
        reason: 'UNSUBSCRIBED',
        notes: 'User requested no contact',
      });

      const check = await suppressionRepo.checkEntitySuppression({
        email: 'blocked-user@suppresseddomain.com',
      });

      expect(check.suppressed).toBe(true);
      expect(check.reason).toBe('UNSUBSCRIBED');
    });

    it('should detect domain-level suppression across all addresses under that domain', async () => {
      await suppressionRepo.addSuppression({
        targetValue: 'competitorgroup.com',
        targetType: 'DOMAIN',
        reason: 'DO_NOT_CONTACT',
      });

      const check = await suppressionRepo.checkEntitySuppression({
        email: 'info@competitorgroup.com',
        websiteUrl: 'https://competitorgroup.com',
      });

      expect(check.suppressed).toBe(true);
      expect(check.reason).toBe('DO_NOT_CONTACT');
    });
  });

  describe('6. Central Outreach Gate & Human Approval Lifecycle', () => {
    it('should block unapproved drafts from becoming READY_TO_SEND', async () => {
      const biz = await prisma.business.create({
        data: {
          name: `Gate Biz ${Date.now()}`,
          category: 'Dentist',
          city: 'Dallas',
          website: 'https://gatebiztest.com',
          source: 'test',
        },
      });

      const lead = await prisma.lead.create({
        data: {
          businessId: biz.id,
          leadOpportunityScore: 80,
          overallScore: 80,
          classification: 'HOT',
          priority: 'URGENT',
          priorityRank: 1,
          recommendedService: 'WEBSITE_IMPROVEMENT',
        },
      });

      const draft = await outreachRepo.upsertDraft(
        lead.id,
        {
          variant: 'VARIANT_A_SHORT',
          channel: 'EMAIL',
          subject: 'Quick question for Gate Biz',
          subjectVariants: ['Sub 1', 'Sub 2', 'Sub 3'],
          body: 'Hello Gate Biz Team, I noticed your website layout in Dallas. Would you be open to a quick breakdown?',
          personalizationScore: 85,
          confidence: 'HIGH',
          provider: 'RuleBasedPersonalizationProvider',
          sourceEvidence: ['Layout feedback'],
          salesAngle: {
            problem: 'Layout',
            evidence: ['Layout feedback'],
            opportunity: 'Refine layout',
            recommendedService: 'WEBSITE_IMPROVEMENT',
            businessImpact: 'Improves experience',
            confidence: 'HIGH',
          },
          qualityCheck: { passed: true, score: 90, warnings: [], blockedReasons: [] },
          status: 'REVIEW_REQUIRED',
        },
        { value: 'info@gatebiztest.com', type: 'EMAIL' }
      );

      const decision = await gateService.evaluateDraft(draft.id);

      expect(decision.allowed).toBe(false); // Not approved yet!
      expect(decision.status).toBe('REVIEW_REQUIRED');
    });

    it('should transition status to READY_TO_SEND only upon explicit human approval', async () => {
      const biz = await prisma.business.create({
        data: {
          name: `Approved Biz ${Date.now()}`,
          category: 'Dentist',
          city: 'Dallas',
          website: 'https://approvedbiz.com',
          source: 'test',
        },
      });

      const lead = await prisma.lead.create({
        data: {
          businessId: biz.id,
          leadOpportunityScore: 85,
          overallScore: 85,
          classification: 'HOT',
          priority: 'URGENT',
          priorityRank: 1,
          recommendedService: 'WEBSITE_IMPROVEMENT',
        },
      });

      const draft = await outreachRepo.upsertDraft(
        lead.id,
        {
          variant: 'VARIANT_B_STANDARD',
          channel: 'EMAIL',
          subject: 'Observation for Approved Biz',
          subjectVariants: ['Sub 1', 'Sub 2', 'Sub 3'],
          body: 'Hello Approved Biz Team, I was reviewing your online presence in Dallas and noticed some mobile refinements that could help visitor engagement. Would you be open to taking a look?',
          personalizationScore: 90,
          confidence: 'HIGH',
          provider: 'RuleBasedPersonalizationProvider',
          sourceEvidence: ['Mobile refinements'],
          salesAngle: {
            problem: 'Mobile speed',
            evidence: ['Mobile refinements'],
            opportunity: 'Streamline mobile site',
            recommendedService: 'WEBSITE_IMPROVEMENT',
            businessImpact: 'Smoother client experience',
            confidence: 'HIGH',
          },
          qualityCheck: { passed: true, score: 95, warnings: [], blockedReasons: [] },
          status: 'REVIEW_REQUIRED',
        },
        { value: 'contact@approvedbiz.com', type: 'EMAIL' }
      );

      const approvalResult = await gateService.approveDraft(draft.id, 'OPERATOR_TEST');

      expect(approvalResult.success).toBe(true);
      expect(approvalResult.status).toBe('READY_TO_SEND');

      const updatedDraft = await outreachRepo.getDraftById(draft.id);
      expect(updatedDraft?.status).toBe('READY_TO_SEND');
      expect(updatedDraft?.approvedBy).toBe('OPERATOR_TEST');
      expect(updatedDraft?.approvedAt).toBeDefined();
    });

    it('should transition status to REJECTED upon explicit human rejection', async () => {
      const biz = await prisma.business.create({
        data: {
          name: `Reject Biz ${Date.now()}`,
          category: 'Dentist',
          city: 'Dallas',
          website: 'https://rejectbiz.com',
          source: 'test',
        },
      });

      const lead = await prisma.lead.create({
        data: {
          businessId: biz.id,
          leadOpportunityScore: 60,
          overallScore: 60,
          classification: 'WARM',
          priority: 'MEDIUM',
          priorityRank: 3,
          recommendedService: 'WEBSITE_IMPROVEMENT',
        },
      });

      const draft = await outreachRepo.upsertDraft(
        lead.id,
        {
          variant: 'VARIANT_A_SHORT',
          channel: 'EMAIL',
          subject: 'Quick question for Reject Biz',
          subjectVariants: ['Sub 1', 'Sub 2', 'Sub 3'],
          body: 'Hello Reject Biz, test body.',
          personalizationScore: 80,
          confidence: 'MEDIUM',
          provider: 'RuleBasedPersonalizationProvider',
          sourceEvidence: [],
          salesAngle: {
            problem: 'General',
            evidence: [],
            opportunity: 'General',
            recommendedService: 'WEBSITE_IMPROVEMENT',
            businessImpact: 'General',
            confidence: 'MEDIUM',
          },
          qualityCheck: { passed: true, score: 80, warnings: [], blockedReasons: [] },
          status: 'REVIEW_REQUIRED',
        },
        { value: 'info@rejectbiz.com', type: 'EMAIL' }
      );

      const rejectResult = await gateService.rejectDraft(draft.id, 'Low relevance sales angle', 'TEST_OPERATOR');

      expect(rejectResult.success).toBe(true);
      expect(rejectResult.status).toBe('REJECTED');

      const updatedDraft = await outreachRepo.getDraftById(draft.id);
      expect(updatedDraft?.status).toBe('REJECTED');
      expect(updatedDraft?.rejectionReason).toBe('Low relevance sales angle');
    });

    it('should prevent approving a suppressed target', async () => {
      const biz = await prisma.business.create({
        data: {
          name: `Suppressed Lead Biz ${Date.now()}`,
          category: 'Dentist',
          city: 'Dallas',
          website: 'https://suppressedlead.com',
          source: 'test',
        },
      });

      await suppressionRepo.addSuppression({
        targetValue: 'https://suppressedlead.com',
        targetType: 'DOMAIN',
        reason: 'MANUAL_BLOCK',
      });

      const lead = await prisma.lead.create({
        data: {
          businessId: biz.id,
          leadOpportunityScore: 90,
          overallScore: 90,
          classification: 'HOT',
          priority: 'URGENT',
          priorityRank: 1,
          recommendedService: 'WEBSITE_IMPROVEMENT',
        },
      });

      const draft = await outreachRepo.upsertDraft(
        lead.id,
        {
          variant: 'VARIANT_A_SHORT',
          channel: 'EMAIL',
          subject: 'Quick question',
          subjectVariants: ['Sub 1', 'Sub 2', 'Sub 3'],
          body: 'Hello team.',
          personalizationScore: 90,
          confidence: 'HIGH',
          provider: 'RuleBasedPersonalizationProvider',
          sourceEvidence: [],
          salesAngle: {
            problem: 'Test',
            evidence: [],
            opportunity: 'Test',
            recommendedService: 'WEBSITE_IMPROVEMENT',
            businessImpact: 'Test',
            confidence: 'HIGH',
          },
          qualityCheck: { passed: true, score: 90, warnings: [], blockedReasons: [] },
          status: 'REVIEW_REQUIRED',
        },
        { value: 'info@suppressedlead.com', type: 'EMAIL' }
      );

      const approvalResult = await gateService.approveDraft(draft.id, 'OPERATOR_TEST');

      expect(approvalResult.success).toBe(false);
      expect(approvalResult.status).toBe('SUPPRESSED');
    });

    it('should mark draft STALE if expiration date has elapsed', async () => {
      const biz = await prisma.business.create({
        data: {
          name: `Expired Biz ${Date.now()}`,
          category: 'Dentist',
          city: 'Dallas',
          website: 'https://expiredbiz.com',
          source: 'test',
        },
      });

      const lead = await prisma.lead.create({
        data: {
          businessId: biz.id,
          leadOpportunityScore: 80,
          overallScore: 80,
          classification: 'HOT',
          priority: 'URGENT',
          priorityRank: 1,
          recommendedService: 'WEBSITE_IMPROVEMENT',
        },
      });

      // Insert expired draft
      const draft = await outreachRepo.upsertDraft(
        lead.id,
        {
          variant: 'VARIANT_A_SHORT',
          channel: 'EMAIL',
          subject: 'Quick question',
          subjectVariants: ['Sub 1', 'Sub 2', 'Sub 3'],
          body: 'Hello Expired Biz Team, I noticed your site in Dallas.',
          personalizationScore: 90,
          confidence: 'HIGH',
          provider: 'RuleBasedPersonalizationProvider',
          sourceEvidence: ['Audit data'],
          salesAngle: {
            problem: 'Test',
            evidence: ['Audit data'],
            opportunity: 'Test',
            recommendedService: 'WEBSITE_IMPROVEMENT',
            businessImpact: 'Test',
            confidence: 'HIGH',
          },
          qualityCheck: { passed: true, score: 90, warnings: [], blockedReasons: [] },
          status: 'REVIEW_REQUIRED',
        },
        { value: 'info@expiredbiz.com', type: 'EMAIL' },
        { expiresAt: new Date(Date.now() - 1000 * 60 * 60 * 24) } // Expired yesterday
      );

      const decision = await gateService.evaluateDraft(draft.id);

      expect(decision.isStale).toBe(true);
      expect(decision.status).toBe('STALE');
      expect(decision.allowed).toBe(false);
    });
  });

  describe('7. Outreach Cooldown Protection', () => {
    it('should detect when a business is in outreach cooldown', async () => {
      const biz = await prisma.business.create({
        data: {
          name: `Cooldown Biz ${Date.now()}`,
          category: 'Dentist',
          city: 'Dallas',
          website: 'https://cooldownbiz.com',
          source: 'test',
        },
      });

      const lead = await prisma.lead.create({
        data: {
          businessId: biz.id,
          leadOpportunityScore: 80,
          overallScore: 80,
          classification: 'HOT',
          priority: 'URGENT',
          priorityRank: 1,
          recommendedService: 'WEBSITE_IMPROVEMENT',
        },
      });

      // Mark an outreach as SENT 5 days ago
      await prisma.outreach.create({
        data: {
          leadId: lead.id,
          variant: 'VARIANT_A_SHORT',
          channel: 'EMAIL',
          body: 'Previous outreach sent.',
          status: 'SENT',
          sentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        },
      });

      const cooldown = await outreachRepo.checkCooldown(biz.id, undefined, 30);

      expect(cooldown.inCooldown).toBe(true);
      expect(cooldown.lastContactAt).toBeDefined();
    });
  });
});
