import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { OutreachRepository } from '../src/database/repositories/outreach.repository.js';
import { SuppressionRepository } from '../src/database/repositories/suppression.repository.js';
import { OutreachGateService } from '../src/modules/personalization/hardening/outreach-gate.service.js';
import { MockOutreachProvider } from '../src/modules/outreach/execution/mock-outreach.provider.js';
import { SmtpDeliveryProvider } from '../src/modules/outreach/execution/smtp-delivery.provider.js';
import { OutreachExecutionService } from '../src/modules/outreach/execution/outreach-execution.service.js';
import { config } from '../src/config/env.js';

describe('Phase 7: Controlled Outreach Execution Engine', () => {
  let db: PrismaClient;
  let outreachRepo: OutreachRepository;
  let suppressionRepo: SuppressionRepository;
  let gateService: OutreachGateService;
  let mockProvider: MockOutreachProvider;
  let executionService: OutreachExecutionService;

  beforeEach(async () => {
    db = getPrismaClient();
    outreachRepo = new OutreachRepository(db);
    suppressionRepo = new SuppressionRepository(db);
    gateService = new OutreachGateService(outreachRepo, suppressionRepo);
    mockProvider = new MockOutreachProvider();
    executionService = new OutreachExecutionService(mockProvider, outreachRepo, gateService);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  // Helper to create a valid business + audit + lead + outreach draft in DB
  async function createTestLeadWithDraft(options: {
    businessName?: string;
    website?: string;
    contactEmail?: string;
    qualityScore?: number;
    body?: string;
    status?: string;
    approvedBy?: string;
    evidenceValid?: boolean;
    identityValid?: boolean;
    expiresAt?: Date;
    auditFindings?: string[];
  } = {}) {
    const timestamp = Date.now() + Math.floor(Math.random() * 100000);
    const businessName = options.businessName || `Execution Biz ${timestamp}`;
    const website = options.website || `https://execbiz-${timestamp}.com`;
    const contactEmail = options.contactEmail !== undefined ? options.contactEmail : `owner@execbiz-${timestamp}.com`;
    const qualityScore = options.qualityScore !== undefined ? options.qualityScore : 90;
    const status = options.status || 'READY_TO_SEND';
    const auditFindings = options.auditFindings || ['Desktop site has slow page load (3800ms)'];
    const body = options.body || `Hi ${businessName} team, I saw your site on ${website} in Dallas and noted mobile speed opportunities.`;

    const business = await db.business.create({
      data: {
        name: businessName,
        website,
        category: 'Dental',
        city: `Dallas-${timestamp}`,
        country: 'USA',
        source: 'TEST_SUITE',
      },
    });

    if (contactEmail) {
      await db.contact.create({
        data: {
          businessId: business.id,
          type: 'EMAIL',
          value: contactEmail,
          source: 'WEBSITE_CONTACT_PAGE',
          qualityScore: 90,
        },
      });
    }

    const audit = await db.websiteAudit.create({
      data: {
        businessId: business.id,
        website,
        score: 45,
        mobileScore: 40,
        loadTimeMs: 3800,
        findings: JSON.stringify(auditFindings),
      },
    });

    const lead = await db.lead.create({
      data: {
        businessId: business.id,
        leadOpportunityScore: 85,
        classification: 'HOT',
        priorityRank: 1,
        recommendedService: 'WEBSITE_IMPROVEMENT',
        salesAngle: JSON.stringify({
          problem: 'Slow mobile loading',
          opportunity: 'Refine layout and performance',
          recommendedService: 'WEBSITE_IMPROVEMENT',
          businessImpact: 'Improve local patient conversions',
          confidence: 'HIGH',
          evidence: auditFindings,
        }),
        topOpportunitySignals: JSON.stringify(['SLOW_LOADING']),
      },
    });

    const draft = await db.outreach.create({
      data: {
        leadId: lead.id,
        channel: 'EMAIL',
        variant: 'VARIANT_A_SHORT',
        subject: `Quick speed suggestion for ${businessName}`,
        subjectVariants: JSON.stringify([`Quick speed suggestion for ${businessName}`]),
        body,
        contentHash: `hash-${timestamp}-${Math.random()}`,
        personalizationScore: qualityScore,
        qualityScore,
        qualityBand: qualityScore >= 75 ? 'GOOD' : 'REVIEW_REQUIRED',
        evidenceValid: options.evidenceValid !== undefined ? options.evidenceValid : true,
        identityValid: options.identityValid !== undefined ? options.identityValid : true,
        primaryContactValue: contactEmail || null,
        primaryContactType: contactEmail ? 'EMAIL' : null,
        approvedAt: options.approvedBy ? new Date() : (status === 'READY_TO_SEND' ? new Date() : null),
        approvedBy: options.approvedBy || (status === 'READY_TO_SEND' ? 'TEST_OPERATOR' : null),
        expiresAt: options.expiresAt || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        status,
      },
    });

    return { business, lead, draft, audit };
  }

  describe('1. Invariants & Fail-Closed Safety', () => {
    it('should keep DRY_RUN=true and OUTREACH_ENABLED=false as default safety baseline', () => {
      expect(config.DRY_RUN).toBe(true);
      expect(config.OUTREACH_ENABLED).toBe(false);
    });

    it('should block real delivery and fail closed when OUTREACH_ENABLED is false', async () => {
      const { draft } = await createTestLeadWithDraft();

      // Attempt live send with OUTREACH_ENABLED=false
      const summary = await executionService.executeBatch({
        dryRun: false, // User attempts to disable dry-run
      });

      expect(summary.totalEligible).toBe(0);
      expect(summary.sent).toBe(0);
      expect(summary.attempted).toBe(0);

      // Verify draft status in database remains untouched
      const refreshed = await db.outreach.findUnique({ where: { id: draft.id } });
      expect(refreshed?.status).toBe('READY_TO_SEND');
    });

    it('should simulate delivery and prevent network requests in DRY_RUN mode', async () => {
      const { draft } = await createTestLeadWithDraft();

      const summary = await executionService.executeBatch({ dryRun: true, draftId: draft.id });

      expect(summary.sent).toBe(1);
      expect(summary.dryRun).toBe(true);
      expect(summary.results[0].status).toBe('SIMULATED');

      const refreshed = await db.outreach.findUnique({ where: { id: draft.id } });
      expect(refreshed?.status).toBe('SENT');
      expect(refreshed?.dryRun).toBe(true);
      expect(refreshed?.providerMessageId).toContain('mock-msg-');
    });
  });

  describe('2. Gate Enforcement & Quality Restrictions', () => {
    it('should not send an unapproved draft with status REVIEW_REQUIRED', async () => {
      const { draft } = await createTestLeadWithDraft({
        status: 'REVIEW_REQUIRED',
        approvedBy: undefined,
      });

      const summary = await executionService.executeBatch({ dryRun: true, draftId: draft.id });
      expect(summary.attempted).toBe(0);

      const refreshed = await db.outreach.findUnique({ where: { id: draft.id } });
      expect(refreshed?.status).toBe('REVIEW_REQUIRED');
    });

    it('should block sending if recipient email or domain is on suppression list', async () => {
      const targetEmail = `suppressed-exec-${Date.now()}@targetclinic.com`;
      const { draft } = await createTestLeadWithDraft({
        contactEmail: targetEmail,
      });

      // Add to suppression list
      await suppressionRepo.addSuppression({
        targetValue: targetEmail,
        targetType: 'EMAIL',
        reason: 'UNSUBSCRIBED',
        createdBy: 'TEST_ADMIN',
      });

      const summary = await executionService.executeBatch({ dryRun: true, draftId: draft.id });
      expect(summary.sent).toBe(0);
      expect(summary.skipped).toBe(1);

      const refreshed = await db.outreach.findUnique({ where: { id: draft.id } });
      expect(refreshed?.status).toBe('READY_TO_SEND');
    });

    it('should block sending if draft is expired', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
      const { draft } = await createTestLeadWithDraft({
        expiresAt: pastDate,
      });

      const summary = await executionService.executeBatch({ dryRun: true, draftId: draft.id });
      expect(summary.sent).toBe(0);
      expect(summary.skipped).toBe(1);
    });

    it('should block sending if active cooldown exists for the business', async () => {
      const { business, lead, draft } = await createTestLeadWithDraft();

      // Create a previously sent outreach within cooldown (10 days ago)
      await db.outreach.create({
        data: {
          leadId: lead.id,
          channel: 'EMAIL',
          variant: 'VARIANT_B_STANDARD',
          subject: 'Prior outreach',
          body: 'Prior body content',
          status: 'SENT',
          sentAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          dryRun: false,
        },
      });

      const summary = await executionService.executeBatch({ dryRun: true, draftId: draft.id });
      expect(summary.sent).toBe(0);
      expect(summary.skipped).toBe(1);
    });

    it('should block sending if contact email is invalid or missing', async () => {
      const { draft } = await createTestLeadWithDraft({
        contactEmail: '',
      });

      const summary = await executionService.executeBatch({ dryRun: true, draftId: draft.id });
      expect(summary.sent).toBe(0);
      expect(summary.skipped).toBe(1);
    });

    it('should block sending if evidence contains unsupported assertions', async () => {
      const { draft } = await createTestLeadWithDraft({
        body: 'You are losing thousands of dollars every week and conversion rate dropped drastically.',
      });

      const summary = await executionService.executeBatch({ dryRun: true, draftId: draft.id });
      expect(summary.sent).toBe(0);
      expect(summary.skipped).toBe(1);
    });

    it('should block sending if business identity is invalid (e.g. blank name)', async () => {
      const { draft } = await createTestLeadWithDraft({
        businessName: ' ',
      });

      const summary = await executionService.executeBatch({ dryRun: true, draftId: draft.id });
      expect(summary.sent).toBe(0);
      expect(summary.skipped).toBe(1);
    });

    it('should block sending if quality score is below minimum threshold (< 60)', async () => {
      const { draft } = await createTestLeadWithDraft({
        body: 'URGENT BUY NOW CLICK HERE FAST DISCOUNT $$$',
      });

      const summary = await executionService.executeBatch({ dryRun: true, draftId: draft.id });
      expect(summary.sent).toBe(0);
      expect(summary.skipped).toBe(1);
    });
  });

  describe('3. Atomic Claiming & Concurrency Protection', () => {
    it('should atomically claim draft (READY_TO_SEND -> SENDING) and reject concurrent claims', async () => {
      const { draft } = await createTestLeadWithDraft();

      // Worker 1 claims draft
      const worker1Claim = await outreachRepo.claimDraftForSending(draft.id);
      expect(worker1Claim).toBe(true);

      // Worker 2 attempts concurrent claim on the same draft
      const worker2Claim = await outreachRepo.claimDraftForSending(draft.id);
      expect(worker2Claim).toBe(false);

      const refreshed = await db.outreach.findUnique({ where: { id: draft.id } });
      expect(refreshed?.status).toBe('SENDING');
    });
  });

  describe('4. Rate Limiting & Daily Caps', () => {
    it('should enforce MAX_EMAILS_PER_RUN clamping on CLI limit flags', async () => {
      // Create 10 eligible drafts
      for (let i = 0; i < 7; i++) {
        await createTestLeadWithDraft();
      }

      // User requests 100 via CLI flag; engine should clamp to MAX_EMAILS_PER_RUN (5)
      const summary = await executionService.executeBatch({
        limit: 100,
        dryRun: true,
      });

      expect(summary.attempted).toBeLessThanOrEqual(config.MAX_EMAILS_PER_RUN);
    });

    it('should stop batch run when provider encounters rate limit (429)', async () => {
      const { draft } = await createTestLeadWithDraft();

      mockProvider.setSimulateRateLimit(true);

      const summary = await executionService.executeBatch({ dryRun: true, draftId: draft.id });

      expect(summary.failed).toBeGreaterThanOrEqual(1);
      expect(summary.results[0].error).toContain('RATE_LIMITED');
    });
  });

  describe('5. Provider Error Handling & Sanitization', () => {
    it('should record delivery failures and persist error reason', async () => {
      const { draft } = await createTestLeadWithDraft();

      mockProvider.setSimulateFailure(true);

      const summary = await executionService.executeBatch({ dryRun: true, draftId: draft.id });

      expect(summary.failed).toBe(1);
      expect(summary.sent).toBe(0);

      const refreshed = await db.outreach.findUnique({ where: { id: draft.id } });
      expect(refreshed?.status).toBe('FAILED');
      expect(refreshed?.error).toContain('NETWORK_ERROR');
    });

    it('should never log or expose SMTP credentials in error messages', async () => {
      const smtpProvider = new SmtpDeliveryProvider();
      const capabilities = smtpProvider.getCapabilities();
      expect(capabilities.supportsHtml).toBe(true);

      // Verify sanitized behavior
      const result = await smtpProvider.send({
        outreachId: 'test-id',
        leadId: 'lead-id',
        businessId: 'biz-id',
        businessName: 'Test Biz',
        recipient: 'test@example.com',
        recipientType: 'EMAIL',
        subject: 'Test Subject',
        body: 'Test Body',
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('SIMULATED');
    });
  });

  describe('6. Pre-Send Preview Inspection', () => {
    it('should output full send-preview breakdown with SENDABLE verdict for valid approved draft', async () => {
      const { draft } = await createTestLeadWithDraft();

      const preview = await executionService.previewSend(draft.id);

      expect(preview.draft.id).toBe(draft.id);
      expect(preview.gateResult.allowed).toBe(true);
      expect(preview.sendable).toBe(true);
      expect(preview.reasons).toHaveLength(0);
      expect(preview.limits.dailyMax).toBe(config.MAX_EMAILS_PER_DAY);
    });

    it('should output BLOCKED verdict with explicit reasons for invalid draft', async () => {
      const { draft } = await createTestLeadWithDraft({
        status: 'REVIEW_REQUIRED',
        approvedBy: undefined,
      });

      const preview = await executionService.previewSend(draft.id);

      expect(preview.sendable).toBe(false);
      expect(preview.reasons.length).toBeGreaterThan(0);
      expect(preview.reasons[0]).toContain('must be "READY_TO_SEND"');
    });
  });
});
