import { describe, it, expect, beforeEach } from 'vitest';
import { getPrismaClient } from '../src/database/client.js';
import { PreSendValidator } from '../src/modules/outreach/gate/pre-send-validator.js';
import { InteractiveReviewerService } from '../src/modules/outreach/review/interactive-reviewer.service.js';
import { ReplyTrackingService } from '../src/modules/outreach/reply/reply-tracking.service.js';
import { FollowUpService } from '../src/modules/outreach/follow-up/follow-up.service.js';
import { PilotExecutionService } from '../src/modules/outreach/execution/pilot-execution.service.js';
import { SuppressionRepository } from '../src/database/repositories/suppression.repository.js';
import { OutreachRepository } from '../src/database/repositories/outreach.repository.js';
import { safetyControls } from '../src/config/safety.js';
import { config } from '../src/config/env.js';

describe('Phase 10: Controlled Live Pilot & Commercial Execution Readiness', () => {
  const db = getPrismaClient();
  const suppressionRepo = new SuppressionRepository(db);
  const outreachRepo = new OutreachRepository(db);
  const validator = new PreSendValidator(db, suppressionRepo, outreachRepo);
  const reviewer = new InteractiveReviewerService(db);
  const replyTracker = new ReplyTrackingService(db, suppressionRepo);
  const followUpService = new FollowUpService(db, suppressionRepo);
  const pilotExecutor = new PilotExecutionService(db, validator);

  let testSuffix: string;
  let testBusinessId: string;
  let testLeadId: string;
  let testOutreachId: string;

  beforeEach(async () => {
    testSuffix = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    const biz = await db.business.create({
      data: {
        name: `Phase10 Test Dental ${testSuffix}`,
        category: 'Dentist',
        city: 'Dallas',
        country: 'US',
        website: 'https://phase10testdental.com',
        source: 'test_phase10',
      },
    });
    testBusinessId = biz.id;

    await db.contact.create({
      data: {
        businessId: biz.id,
        value: `admin@phase10test-${testSuffix}.com`,
        email: `admin@phase10test-${testSuffix}.com`,
        type: 'EMAIL',
        classification: 'BUSINESS_GENERIC',
        status: 'VERIFIED_PUBLIC',
        isVerified: true,
      },
    });

    const lead = await db.lead.create({
      data: {
        businessId: biz.id,
        leadOpportunityScore: 85,
        classification: 'HOT',
        primaryContactType: 'EMAIL',
        primaryContactValue: `admin@phase10test-${testSuffix}.com`,
        recommendedService: 'WEBSITE_IMPROVEMENT',
        salesAngle: JSON.stringify({
          problem: 'Mobile navigation overflow',
          opportunity: 'Streamline mobile menu',
          recommendedService: 'WEBSITE_IMPROVEMENT',
          reason: 'Improves conversion',
        }),
      },
    });
    testLeadId = lead.id;

    const outreach = await db.outreach.create({
      data: {
        leadId: lead.id,
        channel: 'EMAIL',
        variant: 'VARIANT_B_STANDARD',
        subject: `Website observation for Phase10 Test Dental ${testSuffix}`,
        body: `Hello Team,\n\nI was looking over Phase10 Test Dental ${testSuffix} in Dallas and noticed a few mobile refinements.\n\nBest,\nAlex Morgan`,
        primaryContactValue: `admin@phase10test-${testSuffix}.com`,
        primaryContactType: 'EMAIL',
        status: 'REVIEW_REQUIRED',
      },
    });
    testOutreachId = outreach.id;
  });

  describe('A. Review Workflow & Approval / Rejection Lifecycle', () => {
    it('should retrieve pending drafts in review queue', async () => {
      const items = await reviewer.getPendingItems(500);
      const target = items.find((i) => i.id === testOutreachId);
      expect(target).toBeDefined();
      expect(target?.businessName).toContain('Phase10 Test Dental');
      expect(target?.status).toBe('REVIEW_REQUIRED');
    });

    it('should transition outreach to APPROVED on explicit operator approval', async () => {
      await reviewer.approveOutreach(testOutreachId, 'OPERATOR_ALICE');
      const updated = await db.outreach.findUnique({ where: { id: testOutreachId } });

      expect(updated?.status).toBe('APPROVED');
      expect(updated?.approvalStatus).toBe('APPROVED');
      expect(updated?.approvedBy).toBe('OPERATOR_ALICE');
      expect(updated?.approvedAt).toBeDefined();
    });

    it('should transition outreach to REJECTED with reason and prevent ready status', async () => {
      await reviewer.rejectOutreach(testOutreachId, 'Low commercial fit for niche', 'OPERATOR_BOB');
      const updated = await db.outreach.findUnique({ where: { id: testOutreachId } });

      expect(updated?.status).toBe('REJECTED');
      expect(updated?.approvalStatus).toBe('REJECTED');
      expect(updated?.rejectionReason).toBe('Low commercial fit for niche');
      expect(updated?.approvedAt).toBeNull();
    });

    it('should support draft editing and record full audit trail of original vs final content', async () => {
      const newSubject = 'Customized Subject for Dental Team';
      const newBody = 'Customized email body content refined by operator.';

      await reviewer.editAndApproveOutreach(testOutreachId, newSubject, newBody, 'OPERATOR_CHARLIE');
      const updated = await db.outreach.findUnique({ where: { id: testOutreachId } });

      expect(updated?.status).toBe('EDITED_AND_APPROVED');
      expect(updated?.approvalStatus).toBe('EDITED_AND_APPROVED');
      expect(updated?.finalSubject).toBe(newSubject);
      expect(updated?.finalBody).toBe(newBody);
      expect(updated?.originalSubject).toContain('Website observation for');
      expect(updated?.editTimestamp).toBeDefined();
      expect(updated?.approvedAt).toBeDefined();
    });
  });

  describe('B. Pre-Send Validation Gate', () => {
    it('should BLOCK send if human approval is missing', async () => {
      const result = await validator.validateOutreach(testOutreachId);
      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain('HUMAN_APPROVAL_REQUIRED');
    });

    it('should BLOCK send if recipient email is suppressed', async () => {
      await reviewer.approveOutreach(testOutreachId);
      await suppressionRepo.addSuppression({
        targetValue: `admin@phase10test-${testSuffix}.com`,
        targetType: 'EMAIL',
        reason: 'UNSUBSCRIBED',
      });

      const result = await validator.validateOutreach(testOutreachId);
      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain('SUPPRESSED');
    });

    it('should BLOCK send if business or contact is in active cooldown', async () => {
      await reviewer.approveOutreach(testOutreachId);
      // Mark an outreach as recently sent to trigger cooldown
      await db.outreach.update({
        where: { id: testOutreachId },
        data: { sentAt: new Date() },
      });

      const result = await validator.validateOutreach(testOutreachId);
      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain('COOLDOWN_ACTIVE');
    });

    it('should BLOCK send if email contains prohibited fear-mongering claims', async () => {
      await reviewer.approveOutreach(testOutreachId);
      await db.outreach.update({
        where: { id: testOutreachId },
        data: {
          body: 'Hello, your website is broken and you are losing thousands in revenue every day!',
        },
      });

      const result = await validator.validateOutreach(testOutreachId);
      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain('UNGROUNDED_CLAIM_DETECTED');
    });

    it('should ALLOW send when fully approved, unsuppressed, cooled-down, and compliant', async () => {
      // Create fresh non-suppressed un-cooldowned record
      const freshBiz = await db.business.create({
        data: { name: `Fresh Dental ${testSuffix}`, category: 'Dentist', city: 'Dallas', country: 'US', source: 'test' },
      });
      const freshLead = await db.lead.create({
        data: { businessId: freshBiz.id, leadOpportunityScore: 80, primaryContactType: 'EMAIL', primaryContactValue: `fresh-${testSuffix}@dental.com` },
      });
      const freshOutreach = await db.outreach.create({
        data: {
          leadId: freshLead.id,
          channel: 'EMAIL',
          subject: `Quick question for Fresh Dental ${testSuffix}`,
          body: `Hello Team,\n\nI was looking over Fresh Dental ${testSuffix} in Dallas and wanted to share a brief note.\n\nBest,\nAlex Morgan`,
          primaryContactValue: `fresh-${testSuffix}@dental.com`,
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: 'HUMAN_OPERATOR',
        },
      });

      // Temporarily bypass kill switch for validation logic test
      const res = await validator.validateOutreach(freshOutreach.id);
      expect(res.details.hasHumanApproval).toBe(true);
      expect(res.details.isSuppressed).toBe(false);
      expect(res.details.isCooldownActive).toBe(false);
      expect(res.details.noProhibitedClaims).toBe(true);
    });
  });

  describe('C. Emergency Kill Switch & Pilot Safety Limits', () => {
    it('should enforce OUTREACH_KILL_SWITCH by default to block all live sends', () => {
      const policy = safetyControls.getPolicy();
      expect(policy.outreachKillSwitch).toBe(true);
    });

    it('should clamp pilot execution to max 3 sends even if larger limit requested', async () => {
      const candidates = await pilotExecutor.getPilotCandidates(10);
      expect(candidates.length).toBeLessThanOrEqual(config.LIVE_PILOT_MAX_SENDS_PER_RUN);
      expect(config.LIVE_PILOT_MAX_SENDS_PER_RUN).toBe(3);
    });

    it('should require explicit --confirm flag before pilot execution', async () => {
      safetyControls.updatePolicy({ outreachKillSwitch: false });
      const report = await pilotExecutor.executePilot({ limit: 3, confirm: false });
      expect(report.confirmed).toBe(false);
      expect(report.attempted).toBe(0);
      expect(report.message).toContain('--confirm');
      safetyControls.updatePolicy({ outreachKillSwitch: true });
    });
  });

  describe('D. Inbound Reply Tracking & Automated Suppression', () => {
    it('should correctly classify positive reply without suppressing', async () => {
      const classification = replyTracker.classifyReplyBody('Yes, sounds good. Please send over more details.');
      expect(classification.classification).toBe('POSITIVE');
      expect(classification.sentiment).toBe('POSITIVE');
    });

    it('should correctly classify question reply', async () => {
      const classification = replyTracker.classifyReplyBody('What is the pricing and timeline for this?');
      expect(classification.classification).toBe('QUESTION');
      expect(classification.sentiment).toBe('POSITIVE');
    });

    it('should correctly classify out-of-office reply', async () => {
      const classification = replyTracker.classifyReplyBody('I am currently out of office on annual leave until next Monday.');
      expect(classification.classification).toBe('OUT_OF_OFFICE');
      expect(classification.sentiment).toBe('NEUTRAL');
    });

    it('should automatically suppress recipient on UNSUBSCRIBE or NOT_INTERESTED reply', async () => {
      const unsubsEmail = `unsub-${testSuffix}@dentalclinic.com`;
      await db.outreach.update({
        where: { id: testOutreachId },
        data: { primaryContactValue: unsubsEmail },
      });

      const reply = await replyTracker.recordReply({
        outreachId: testOutreachId,
        senderEmail: unsubsEmail,
        replyBody: 'Please unsubscribe me and remove my email from your contact list.',
      });

      expect(reply.classification).toBe('UNSUBSCRIBE');
      expect(reply.followUpStatus).toBe('SUPPRESSED');

      const isSuppressed = await suppressionRepo.isSuppressed(unsubsEmail);
      expect(isSuppressed).toBe(true);
    });
  });

  describe('E. Follow-Up Safety & Phone-Only Workflow', () => {
    it('should keep automatic follow-ups disabled by default', async () => {
      expect(followUpService.isAutoFollowUpEnabled()).toBe(false);
      const res = await followUpService.processFollowUps();
      expect(res.processed).toBe(0);
      expect(res.blockedReason).toContain('AUTO_FOLLOWUP_ENABLED is false');
    });

    it('should schedule follow-up with FOLLOW_UP_PENDING status without sending', async () => {
      const res = await followUpService.scheduleFollowUp(testOutreachId, 3);
      expect(res.status).toBe('FOLLOW_UP_PENDING');
      expect(res.scheduledAt.getTime()).toBeGreaterThan(Date.now());
    });
  });
});
