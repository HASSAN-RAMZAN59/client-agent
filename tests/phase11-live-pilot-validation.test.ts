import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPrismaClient } from '../src/database/client.js';
import { PreSendValidator } from '../src/modules/outreach/gate/pre-send-validator.js';
import { PilotExecutionService } from '../src/modules/outreach/execution/pilot-execution.service.js';
import { ReplyTrackingService } from '../src/modules/outreach/reply/reply-tracking.service.js';
import { SuppressionRepository } from '../src/database/repositories/suppression.repository.js';
import { OutreachRepository } from '../src/database/repositories/outreach.repository.js';
import { SmtpDeliveryProvider } from '../src/modules/outreach/execution/smtp-delivery.provider.js';
import { safetyControls } from '../src/config/safety.js';
import { config } from '../src/config/env.js';

describe('Phase 11: Controlled Live Pilot Validation & Real-World Delivery Verification', () => {
  const db = getPrismaClient();
  const suppressionRepo = new SuppressionRepository(db);
  const outreachRepo = new OutreachRepository(db);
  const validator = new PreSendValidator(db, suppressionRepo, outreachRepo);
  const replyTracker = new ReplyTrackingService(db, suppressionRepo);

  let testSuffix: string;
  let testCampaignId: string;
  let testBusinessId: string;
  let testLeadId: string;
  let testOutreachId: string;
  let testRecipient: string;

  beforeEach(async () => {
    testSuffix = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    testRecipient = `pilot-admin-${testSuffix}@dentalclinic.com`;

    const campaign = await db.campaign.create({
      data: {
        name: `Phase 11 Pilot Campaign ${testSuffix}`,
        country: 'US',
        city: 'Dallas',
        niche: 'Dentist',
        targetBusinesses: 10,
      },
    });
    testCampaignId = campaign.id;

    const biz = await db.business.create({
      data: {
        campaignId: campaign.id,
        name: `Phase11 Valid Dental ${testSuffix}`,
        category: 'Dentist',
        city: 'Dallas',
        country: 'US',
        website: 'https://phase11validdental.com',
        source: 'test_phase11',
      },
    });
    testBusinessId = biz.id;

    await db.contact.create({
      data: {
        businessId: biz.id,
        value: testRecipient,
        email: testRecipient,
        type: 'EMAIL',
        classification: 'BUSINESS_GENERIC',
        status: 'VERIFIED_PUBLIC',
        isVerified: true,
        sourceUrl: 'https://phase11validdental.com/contact',
      },
    });

    const lead = await db.lead.create({
      data: {
        businessId: biz.id,
        leadOpportunityScore: 88,
        classification: 'HOT',
        primaryContactType: 'EMAIL',
        primaryContactValue: testRecipient,
        recommendedService: 'WEBSITE_IMPROVEMENT',
        salesAngle: JSON.stringify({
          problem: 'Navigation layout overflow',
          opportunity: 'Refactor mobile navigation menu',
          recommendedService: 'WEBSITE_IMPROVEMENT',
          reason: 'Boost patient booking conversions',
        }),
      },
    });
    testLeadId = lead.id;

    const outreach = await db.outreach.create({
      data: {
        leadId: lead.id,
        channel: 'EMAIL',
        variant: 'VARIANT_B_STANDARD',
        subject: `Website observation for Phase11 Valid Dental ${testSuffix}`,
        body: `Hello Team,\n\nI was looking over Phase11 Valid Dental ${testSuffix} in Dallas and noticed a few mobile menu improvements.\n\nBest regards,\n\nHASSAN RAMZAN`,
        primaryContactValue: testRecipient,
        primaryContactType: 'EMAIL',
        status: 'APPROVED',
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: 'HUMAN_OPERATOR',
      },
    });
    testOutreachId = outreach.id;
  });

  describe('1. Pilot Preview & Pre-Send Eligibility Gate', () => {
    it('1. pilot-preview should inspect candidates and result in exactly 0 network sends', async () => {
      const executor = new PilotExecutionService(db, validator);
      const preview = await executor.previewPilot(3);

      expect(preview.networkSends).toBe(0);
      expect(Array.isArray(preview.candidates)).toBe(true);
      expect(preview.candidates.length).toBeLessThanOrEqual(3);
    });

    it('2. missing --confirm flag must strictly block execution with informative reason', async () => {
      const executor = new PilotExecutionService(db, validator);
      safetyControls.updatePolicy({ outreachKillSwitch: false });
      const report = await executor.executePilot({ limit: 3, confirm: false });

      expect(report.confirmed).toBe(false);
      expect(report.attempted).toBe(0);
      expect(report.sent).toBe(0);
      expect(report.message).toContain('explicit --confirm flag required');
      safetyControls.updatePolicy({ outreachKillSwitch: true });
    });

    it('3. unapproved draft (DRAFT / REVIEW_REQUIRED) must be BLOCKED by eligibility gate', async () => {
      await db.outreach.update({
        where: { id: testOutreachId },
        data: { status: 'REVIEW_REQUIRED', approvedAt: null },
      });

      const res = await validator.isLivePilotEligible(testOutreachId);
      expect(res.eligible).toBe(false);
      expect(res.reasons).toContain('NOT_HUMAN_APPROVED');
    });

    it('4. unverified email must be BLOCKED by eligibility gate', async () => {
      await db.outreach.update({
        where: { id: testOutreachId },
        data: { primaryContactValue: 'invalid-email-address' },
      });

      const res = await validator.isLivePilotEligible(testOutreachId);
      expect(res.eligible).toBe(false);
      const hasEmailBlock = res.reasons.includes('EMAIL_NOT_VERIFIED') || res.reasons.includes('INVALID_EMAIL_CONTACT');
      expect(hasEmailBlock).toBe(true);
    });

    it('5. guessed email must be BLOCKED by eligibility gate', async () => {
      await db.contact.updateMany({
        where: { businessId: testBusinessId },
        data: { status: 'NONE_FOUND' },
      });

      const res = await validator.isLivePilotEligible(testOutreachId);
      expect(res.eligible).toBe(false);
      expect(res.reasons).toContain('GUESSED_EMAIL');
    });

    it('6. phone-only channel must be BLOCKED from email pilot', async () => {
      await db.outreach.update({
        where: { id: testOutreachId },
        data: { channel: 'PHONE' },
      });

      const res = await validator.isLivePilotEligible(testOutreachId);
      expect(res.eligible).toBe(false);
      expect(res.reasons).toContain('PHONE_CHANNEL');
    });

    it('7. contact-form channel must be BLOCKED from email pilot', async () => {
      await db.outreach.update({
        where: { id: testOutreachId },
        data: { channel: 'CONTACT_FORM' },
      });

      const res = await validator.isLivePilotEligible(testOutreachId);
      expect(res.eligible).toBe(false);
      expect(res.reasons).toContain('CONTACT_FORM_CHANNEL');
    });

    it('8. suppressed recipient or domain must be BLOCKED', async () => {
      await suppressionRepo.addSuppression({
        targetValue: testRecipient,
        targetType: 'EMAIL',
        reason: 'UNSUBSCRIBED',
      });

      const res = await validator.isLivePilotEligible(testOutreachId);
      expect(res.eligible).toBe(false);
      expect(res.reasons).toContain('SUPPRESSED_RECIPIENT');
    });

    it('9. active cooldown window must BLOCK candidate', async () => {
      await db.outreach.update({
        where: { id: testOutreachId },
        data: { sentAt: new Date() },
      });

      const res = await validator.isLivePilotEligible(testOutreachId);
      expect(res.eligible).toBe(false);
      expect(res.reasons).toContain('COOLDOWN_ACTIVE');
    });
  });

  describe('2. Hard Limits, Kill Switch & Environment Invariants', () => {
    it('10. daily limit of 3 sends must block subsequent live sends when reached', async () => {
      // Mock getTodaySentCount to return 3
      const mockValidator = new PreSendValidator(db, suppressionRepo, outreachRepo);
      vi.spyOn(mockValidator, 'getTodaySentCount').mockResolvedValue(3);

      const res = await mockValidator.isLivePilotEligible(testOutreachId, { checkDailyLimit: true });
      expect(res.eligible).toBe(false);
      expect(res.reasons).toContain('DAILY_LIMIT_REACHED');
    });

    it('11. per-run limit must strictly cap candidates to max 3 items', async () => {
      const executor = new PilotExecutionService(db, validator);
      const candidates = await executor.getPilotCandidates(50);
      expect(candidates.length).toBeLessThanOrEqual(3);
    });

    it('12. DRY_RUN=true must guarantee zero network sends', async () => {
      const executor = new PilotExecutionService(db, validator);
      safetyControls.updatePolicy({ outreachKillSwitch: false });

      const report = await executor.executePilot({ limit: 3, confirm: true, dryRun: true, campaignId: testCampaignId });
      expect(report.sent).toBe(0);
      expect(report.message).toContain('DRY RUN — ZERO REAL MESSAGES SENT');

      safetyControls.updatePolicy({ outreachKillSwitch: true });
    });

    it('13. OUTREACH_ENABLED=false flag check in eligibility gate', async () => {
      const res = await validator.isLivePilotEligible(testOutreachId, { checkEnvFlags: true });
      expect(res.reasons).toContain('OUTREACH_DISABLED');
    });

    it('14. LIVE_PILOT_ENABLED=false flag check in eligibility gate', async () => {
      const res = await validator.isLivePilotEligible(testOutreachId, { checkEnvFlags: true });
      expect(res.reasons).toContain('PILOT_DISABLED');
    });

    it('15. OUTREACH_KILL_SWITCH=true immediately blocks all sends', async () => {
      safetyControls.updatePolicy({ outreachKillSwitch: true });
      const executor = new PilotExecutionService(db, validator);
      const report = await executor.executePilot({ limit: 3, confirm: true });

      expect(report.attempted).toBe(0);
      expect(report.sent).toBe(0);
      expect(report.message).toContain('OUTREACH KILL SWITCH ACTIVE');
    });

    it('16. duplicate send to same recipient within batch must be BLOCKED', async () => {
      const executor = new PilotExecutionService(db, validator);
      safetyControls.updatePolicy({ outreachKillSwitch: false });

      // Execute simulation
      const report = await executor.executePilot({ limit: 3, confirm: true, dryRun: true, campaignId: testCampaignId });
      expect(report.duplicateBlocked).toBeDefined();

      safetyControls.updatePolicy({ outreachKillSwitch: true });
    });
  });

  describe('3. SMTP Delivery, Failures & Audit Trail', () => {
    it('17. successful SMTP delivery updates outreach record to SENT with message ID', async () => {
      const mockSmtp = new SmtpDeliveryProvider();
      vi.spyOn(mockSmtp, 'send').mockResolvedValue({
        success: true,
        status: 'SENT',
        messageId: 'smtp-msg-test-12345',
        attemptedAt: new Date(),
        providerName: 'SmtpProvider',
      });

      const executor = new PilotExecutionService(db, validator, mockSmtp);
      safetyControls.updatePolicy({ outreachKillSwitch: false, isDryRun: false });

      // Temporarily mock environment to live mode for test
      const originalOutreach = config.OUTREACH_ENABLED;
      const originalPilot = config.LIVE_PILOT_ENABLED;
      (config as any).OUTREACH_ENABLED = true;
      (config as any).LIVE_PILOT_ENABLED = true;

      const report = await executor.executePilot({
        limit: 1,
        confirm: true,
        dryRun: false,
        campaignId: testCampaignId,
        includeTest: true,
        allowTestRecord: true,
      });
      expect(report.sent).toBeGreaterThanOrEqual(1);

      const record = await db.outreach.findUnique({ where: { id: testOutreachId } });
      expect(record?.status).toBe('SENT');
      expect(record?.providerMessageId).toBe('smtp-msg-test-12345');
      expect(record?.sentAt).toBeDefined();

      (config as any).OUTREACH_ENABLED = originalOutreach;
      (config as any).LIVE_PILOT_ENABLED = originalPilot;
      safetyControls.updatePolicy({ outreachKillSwitch: true, isDryRun: true });
    });

    it('18. permanent SMTP failure updates outreach record to FAILED without automatic retry', async () => {
      const mockSmtp = new SmtpDeliveryProvider();
      vi.spyOn(mockSmtp, 'send').mockResolvedValue({
        success: false,
        status: 'FAILED',
        error: '550 5.1.1 User unknown: recipient address rejected',
        attemptedAt: new Date(),
        providerName: 'SmtpProvider',
      });

      const executor = new PilotExecutionService(db, validator, mockSmtp);
      safetyControls.updatePolicy({ outreachKillSwitch: false, isDryRun: false });

      const originalOutreach = config.OUTREACH_ENABLED;
      const originalPilot = config.LIVE_PILOT_ENABLED;
      (config as any).OUTREACH_ENABLED = true;
      (config as any).LIVE_PILOT_ENABLED = true;

      const report = await executor.executePilot({
        limit: 1,
        confirm: true,
        dryRun: false,
        campaignId: testCampaignId,
        includeTest: true,
        allowTestRecord: true,
      });
      expect(report.failed).toBeGreaterThanOrEqual(1);

      const record = await db.outreach.findUnique({ where: { id: testOutreachId } });
      expect(record?.status).toBe('FAILED');
      expect(record?.error).toContain('550 5.1.1 User unknown');

      (config as any).OUTREACH_ENABLED = originalOutreach;
      (config as any).LIVE_PILOT_ENABLED = originalPilot;
      safetyControls.updatePolicy({ outreachKillSwitch: true, isDryRun: true });
    });

    it('19. temporary SMTP failure records failure without infinite retry loop', async () => {
      const mockSmtp = new SmtpDeliveryProvider();
      vi.spyOn(mockSmtp, 'send').mockResolvedValue({
        success: false,
        status: 'FAILED',
        error: '421 4.7.0 Connection timeout: try again later',
        attemptedAt: new Date(),
        providerName: 'SmtpProvider',
      });

      const executor = new PilotExecutionService(db, validator, mockSmtp);
      safetyControls.updatePolicy({ outreachKillSwitch: false, isDryRun: false });

      const originalOutreach = config.OUTREACH_ENABLED;
      const originalPilot = config.LIVE_PILOT_ENABLED;
      (config as any).OUTREACH_ENABLED = true;
      (config as any).LIVE_PILOT_ENABLED = true;

      const report = await executor.executePilot({
        limit: 1,
        confirm: true,
        dryRun: false,
        campaignId: testCampaignId,
        includeTest: true,
        allowTestRecord: true,
      });
      expect(report.attempted).toBe(1);

      (config as any).OUTREACH_ENABLED = originalOutreach;
      (config as any).LIVE_PILOT_ENABLED = originalPilot;
      safetyControls.updatePolicy({ outreachKillSwitch: true, isDryRun: true });
    });

    it('20. unknown delivery result requires manual review without blind resending', async () => {
      const mockSmtp = new SmtpDeliveryProvider();
      vi.spyOn(mockSmtp, 'send').mockRejectedValue(new Error('Connection unexpectedly dropped during SMTP DATA'));

      const executor = new PilotExecutionService(db, validator, mockSmtp);
      safetyControls.updatePolicy({ outreachKillSwitch: false, isDryRun: false });

      const originalOutreach = config.OUTREACH_ENABLED;
      const originalPilot = config.LIVE_PILOT_ENABLED;
      (config as any).OUTREACH_ENABLED = true;
      (config as any).LIVE_PILOT_ENABLED = true;

      const report = await executor.executePilot({
        limit: 1,
        confirm: true,
        dryRun: false,
        campaignId: testCampaignId,
        includeTest: true,
        allowTestRecord: true,
      });
      expect(report.unknown).toBeGreaterThanOrEqual(1);

      (config as any).OUTREACH_ENABLED = originalOutreach;
      (config as any).LIVE_PILOT_ENABLED = originalPilot;
      safetyControls.updatePolicy({ outreachKillSwitch: true, isDryRun: true });
    });
  });

  describe('4. Inbound Reply Tracking, Suppression & Audit Integrity', () => {
    it('21. unsubscribe incoming reply automatically creates persistent suppression record', async () => {
      const reply = await replyTracker.recordReply({
        outreachId: testOutreachId,
        senderEmail: testRecipient,
        replyBody: 'Please unsubscribe me immediately from any further communications.',
      });

      expect(reply.classification).toBe('UNSUBSCRIBE');
      expect(reply.followUpStatus).toBe('SUPPRESSED');

      const isSuppressed = await suppressionRepo.isSuppressed(testRecipient);
      expect(isSuppressed).toBe(true);
    });

    it('22. not-interested reply automatically triggers suppression', async () => {
      const otherRecipient = `notinterested-${testSuffix}@dentalclinic.com`;
      await db.outreach.update({
        where: { id: testOutreachId },
        data: { primaryContactValue: otherRecipient },
      });

      const reply = await replyTracker.recordReply({
        outreachId: testOutreachId,
        senderEmail: otherRecipient,
        replyBody: 'Not interested at all, please remove our company.',
      });

      expect(reply.classification).toBe('NOT_INTERESTED');
      const isSuppressed = await suppressionRepo.isSuppressed(otherRecipient);
      expect(isSuppressed).toBe(true);
    });

    it('23. incoming positive reply records status without sending automated response', async () => {
      const reply = await replyTracker.recordReply({
        outreachId: testOutreachId,
        senderEmail: testRecipient,
        replyBody: 'Yes, please send over details regarding the mobile menu audit.',
      });

      expect(reply.classification).toBe('POSITIVE');
      const outreach = await db.outreach.findUnique({ where: { id: testOutreachId } });
      expect(outreach?.status).toBe('REPLIED');
    });

    it('24. CLI parameters cannot override hard limit cap of 3', async () => {
      const executor = new PilotExecutionService(db, validator);
      const preview = await executor.previewPilot(100);
      expect(preview.candidates.length).toBeLessThanOrEqual(3);
    });

    it('25. kill switch is checked immediately before dispatch', async () => {
      const executor = new PilotExecutionService(db, validator);
      safetyControls.updatePolicy({ outreachKillSwitch: true });

      const report = await executor.executePilot({ limit: 3, confirm: true });
      expect(report.sent).toBe(0);
      expect(report.attempted).toBe(0);
      expect(report.message).toContain('KILL SWITCH ACTIVE');
    });

    it('26. complete audit trail is persisted on approved outreach', async () => {
      const outreach = await db.outreach.findUnique({ where: { id: testOutreachId } });

      expect(outreach?.approvedAt).toBeDefined();
      expect(outreach?.approvedBy).toBe('HUMAN_OPERATOR');
      expect(outreach?.approvalStatus).toBe('APPROVED');
      expect(outreach?.subject).toContain('Website observation for');
      expect(outreach?.body).toBeDefined();
    });
  });

  describe('5. Real Sender Identity, Branch Matching & Draft Quality Hardening', () => {
    it('27. default sender identity uses HASSAN RAMZAN and hassanramzan59@gmail.com', () => {
      expect(config.SMTP_FROM_NAME).toBe('HASSAN RAMZAN');
      expect(config.SMTP_FROM_EMAIL).toBe('hassanramzan59@gmail.com');
      expect(config.SMTP_HOST).toBe('smtp.gmail.com');
    });

    it('28. draft generator formats clean signature without placeholder agency', async () => {
      const { PersonalizationService } = await import('../src/modules/personalization/personalization.service.js');
      const service = new PersonalizationService(db);
      const res = await service.personalizeLead(testLeadId);

      for (const variant of res.variants) {
        expect(variant.body).toContain('HASSAN RAMZAN');
        expect(variant.body).not.toContain('ModernWeb Studio');
        expect(variant.body).not.toContain('Alex Morgan');
        expect(variant.body).not.toContain('..'); // No double periods
      }
    });

    it('29. multi-location mismatch (e.g. cambridge@ on Toronto business) is BLOCKED with LOCATION_CONTACT_MISMATCH', async () => {
      const mismatchBiz = await db.business.create({
        data: {
          name: `Toronto Multi-Location Clinic ${testSuffix}`,
          category: 'Dentist',
          city: 'Toronto',
          country: 'CA',
          website: 'https://multibranch.ca',
          source: 'test_phase11',
        },
      });

      const mismatchContact = await db.contact.create({
        data: {
          businessId: mismatchBiz.id,
          value: 'cambridge@multibranch.ca',
          email: 'cambridge@multibranch.ca',
          type: 'EMAIL',
          classification: 'BUSINESS_GENERIC',
          status: 'VERIFIED_PUBLIC',
          isVerified: true,
        },
      });

      const mismatchLead = await db.lead.create({
        data: {
          businessId: mismatchBiz.id,
          leadOpportunityScore: 75,
          classification: 'WARM',
          primaryContactType: 'EMAIL',
          primaryContactValue: mismatchContact.value,
        },
      });

      const mismatchOutreach = await db.outreach.create({
        data: {
          leadId: mismatchLead.id,
          channel: 'EMAIL',
          variant: 'VARIANT_B_STANDARD',
          subject: 'Website observation for Toronto Multi-Location Clinic',
          body: 'Hello Team,\n\nI was reviewing the website...\n\nBest regards,\n\nHASSAN RAMZAN',
          primaryContactValue: mismatchContact.value,
          primaryContactType: 'EMAIL',
          status: 'APPROVED',
          approvalStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: 'HUMAN_OPERATOR',
        },
      });

      const res = await validator.isLivePilotEligible(mismatchOutreach.id);
      expect(res.eligible).toBe(false);
      expect(res.reasons).toContain('LOCATION_CONTACT_MISMATCH');
    });
  });
});
