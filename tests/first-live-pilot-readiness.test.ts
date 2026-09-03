import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { PilotExecutionService } from '../src/modules/outreach/execution/pilot-execution.service.js';
import { PreSendValidator } from '../src/modules/outreach/gate/pre-send-validator.js';
import { SmtpDeliveryProvider } from '../src/modules/outreach/execution/smtp-delivery.provider.js';
import { MockOutreachProvider } from '../src/modules/outreach/execution/mock-outreach.provider.js';
import { ContentHasher } from '../src/modules/personalization/hardening/content-hasher.js';
import { safetyControls } from '../src/config/safety.js';
import { config } from '../src/config/env.js';

const db = getPrismaClient();

describe('First Live Pilot Readiness & Safety Verification Tests', () => {
  let testCampaignId: string;
  let testSuffix: string;
  let cleanSuffix: string;
  const validator = new PreSendValidator(db);

  beforeEach(async () => {
    testSuffix = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    cleanSuffix = testSuffix.replace(/[^a-zA-Z0-9]/g, '');

    const campaign = await db.campaign.create({
      data: {
        name: `Dallas Pilot Live Safety ${testSuffix}`,
        country: 'US',
        city: 'Dallas',
        state: 'TX',
        niche: 'Dentist,HVAC',
        targetBusinesses: 10,
      },
    });
    testCampaignId = campaign.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  async function createCandidateFixture(opts: {
    name: string;
    city?: string;
    country?: string;
    category?: string;
    campaignId?: string;
    email?: string;
    sourceUrl?: string;
    status?: string;
    approvedAt?: Date | null;
    isVerified?: boolean;
    isPublic?: boolean;
    contactStatus?: string;
    subject?: string;
    body?: string;
    contentHash?: string;
  }) {
    const biz = await db.business.create({
      data: {
        name: `LiveTest ${opts.name} ${cleanSuffix}`,
        city: opts.city || 'Dallas',
        country: opts.country || 'US',
        category: opts.category || 'Dentist',
        website: `https://${opts.name.toLowerCase().replace(/[^a-z0-9]/g, '')}-${cleanSuffix}.com`,
        source: 'test_fixture',
        campaignId: opts.campaignId !== undefined ? opts.campaignId : testCampaignId,
      },
    });

    await db.websiteAudit.create({
      data: {
        businessId: biz.id,
        website: biz.website!,
        status: 'AUDITED',
        score: 80,
        loadTimeMs: 5200,
        issuesJson: JSON.stringify(['Critical Page Load Latency']),
        findings: JSON.stringify(['Mobile performance optimization needed']),
      },
    });

    const lead = await db.lead.create({
      data: {
        businessId: biz.id,
        leadOpportunityScore: 55,
        overallScore: 55,
        classification: 'WARM',
        priority: 'HIGH',
        priorityRank: 2,
        confidenceLevel: 'HIGH',
        recommendedService: 'WEBSITE_IMPROVEMENT',
        topProblems: JSON.stringify(['Critical Page Load Latency']),
        salesAngle: JSON.stringify({
          problem: 'Slow initial mobile page load speed.',
          opportunity: 'Optimize page assets.',
          recommendedService: 'WEBSITE_IMPROVEMENT',
        }),
        status: 'QUALIFIED',
      },
    });

    const emailVal = opts.email || `contact@${opts.name.toLowerCase().replace(/[^a-z0-9]/g, '')}-${cleanSuffix}.com`;
    await db.contact.create({
      data: {
        businessId: biz.id,
        type: 'EMAIL',
        value: emailVal,
        status: opts.contactStatus || 'VERIFIED_PUBLIC',
        source: 'official_website_html',
        sourceUrl: opts.sourceUrl !== undefined ? opts.sourceUrl : `${biz.website}/contact`,
        emailAsFound: emailVal,
        isVerified: opts.isVerified !== undefined ? opts.isVerified : true,
        isPublic: opts.isPublic !== undefined ? opts.isPublic : true,
        discoveredAt: new Date(),
      },
    });

    const subject = opts.subject || `Website observation for ${biz.name}`;
    const body =
      opts.body ||
      `Hello ${biz.name} Team,\n\nMobile load time recorded at 5.2 seconds.\n\nBest regards,\nHASSAN RAMZAN\nhassanramzan59@gmail.com\n\nWeb development outreach\n\n55 jb baba bakala faisalabad\n\nIf you'd rather not receive emails from me, just reply "unsubscribe" and I won't contact you again.`;

    const contentHash = opts.contentHash || ContentHasher.hashDraft(subject, body);

    const outreach = await db.outreach.create({
      data: {
        leadId: lead.id,
        variant: 'VARIANT_B_STANDARD',
        channel: 'EMAIL',
        subject,
        body,
        contentHash,
        qualityScore: 95,
        qualityBand: 'EXCELLENT',
        status: opts.status || 'READY_TO_SEND',
        approvalStatus: opts.status === 'READY_TO_SEND' ? 'APPROVED' : 'REVIEW_REQUIRED',
        approvedAt: opts.approvedAt !== undefined ? opts.approvedAt : new Date(),
        primaryContactValue: emailVal,
        primaryContactType: 'EMAIL',
        evidenceValid: true,
        identityValid: true,
      },
    });

    return { biz, lead, outreach };
  }

  // 1 & 2. First live pilot maximum = 1 even if limit > 1 requested
  it('1 & 2. should enforce server-side maximum of 1 send in live mode even if limit > 1 is requested', async () => {
    await createCandidateFixture({ name: 'CandidateOne', category: 'HVAC' });
    await createCandidateFixture({ name: 'CandidateTwo', category: 'Dentist' });

    const mockSmtp = {
      name: 'SmtpDeliveryProvider',
      isNetworkTransport: true,
      isAvailable: async () => true,
      send: vi.fn().mockResolvedValue({
        success: true,
        status: 'SENT',
        messageId: 'smtp-msg-mock-123',
        attemptedAt: new Date(),
        providerName: 'SmtpDeliveryProvider',
        dryRun: false,
      }),
      getCapabilities: () => ({ supportsHtml: true, supportsAttachments: false }),
    } as unknown as SmtpDeliveryProvider;

    const liveService = new PilotExecutionService(db, validator, mockSmtp);

    const originalKillSwitch = safetyControls.isKillSwitchActive();
    const originalOutreach = config.OUTREACH_ENABLED;
    const originalPilot = config.LIVE_PILOT_ENABLED;
    const originalDryRun = config.DRY_RUN;

    try {
      safetyControls.updatePolicy({ outreachKillSwitch: false, isDryRun: false });
      (config as any).OUTREACH_ENABLED = true;
      (config as any).LIVE_PILOT_ENABLED = true;
      (config as any).DRY_RUN = false;

      const report = await liveService.executePilot({
        campaignId: testCampaignId,
        country: 'US' as any,
        limit: 5, // requested > 1
        confirm: true,
        live: true,
        allowTestRecord: true,
      });

      expect(report.sent).toBe(1);
      expect(mockSmtp.send).toHaveBeenCalledTimes(1);
    } finally {
      safetyControls.updatePolicy({ outreachKillSwitch: originalKillSwitch, isDryRun: originalDryRun });
      (config as any).OUTREACH_ENABLED = originalOutreach;
      (config as any).LIVE_PILOT_ENABLED = originalPilot;
      (config as any).DRY_RUN = originalDryRun;
    }
  });

  // 3. Candidate #2 remains unsent in live mode
  it('3. candidate #2 must remain READY_TO_SEND and UNSENT after first send', async () => {
    const c1 = await createCandidateFixture({ name: 'FirstCandidate', category: 'HVAC' });
    const c2 = await createCandidateFixture({ name: 'SecondCandidate', category: 'Dentist' });

    const mockSmtp = {
      name: 'SmtpDeliveryProvider',
      isNetworkTransport: true,
      isAvailable: async () => true,
      send: vi.fn().mockResolvedValue({
        success: true,
        status: 'SENT',
        messageId: 'smtp-first-msg',
        attemptedAt: new Date(),
        providerName: 'SmtpDeliveryProvider',
        dryRun: false,
      }),
      getCapabilities: () => ({ supportsHtml: true, supportsAttachments: false }),
    } as unknown as SmtpDeliveryProvider;

    const liveService = new PilotExecutionService(db, validator, mockSmtp);

    const originalKillSwitch = safetyControls.isKillSwitchActive();
    const originalOutreach = config.OUTREACH_ENABLED;
    const originalPilot = config.LIVE_PILOT_ENABLED;
    const originalDryRun = config.DRY_RUN;

    try {
      safetyControls.updatePolicy({ outreachKillSwitch: false, isDryRun: false });
      (config as any).OUTREACH_ENABLED = true;
      (config as any).LIVE_PILOT_ENABLED = true;
      (config as any).DRY_RUN = false;

      await liveService.executePilot({
        campaignId: testCampaignId,
        limit: 1,
        confirm: true,
        live: true,
        allowTestRecord: true,
      });

      const updatedC2 = await db.outreach.findUnique({ where: { id: c2.outreach.id } });
      expect(updatedC2?.status).toBe('READY_TO_SEND');
      expect(updatedC2?.sentAt).toBeNull();
      expect(updatedC2?.providerMessageId).toBeNull();
    } finally {
      safetyControls.updatePolicy({ outreachKillSwitch: originalKillSwitch, isDryRun: originalDryRun });
      (config as any).OUTREACH_ENABLED = originalOutreach;
      (config as any).LIVE_PILOT_ENABLED = originalPilot;
      (config as any).DRY_RUN = originalDryRun;
    }
  });

  // 4. Live requires explicit human approval
  it('4. live requires explicit human approval; unapproved candidate is blocked', async () => {
    const unapproved = await createCandidateFixture({
      name: 'UnapprovedBiz',
      status: 'REVIEW_REQUIRED',
      approvedAt: null,
    });

    const eligibility = await validator.isLivePilotEligible(unapproved.outreach.id, {
      checkEnvFlags: false,
      dryRun: false,
      allowTestRecord: true,
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toContain('NOT_HUMAN_APPROVED');
  });

  // 5. Live requires explicit --confirm
  it('5. live execution requires explicit --confirm flag', async () => {
    await createCandidateFixture({ name: 'ConfirmTestBiz' });
    const service = new PilotExecutionService(db, validator);

    const originalKillSwitch = safetyControls.isKillSwitchActive();
    const originalOutreach = config.OUTREACH_ENABLED;
    const originalPilot = config.LIVE_PILOT_ENABLED;
    const originalDryRun = config.DRY_RUN;

    try {
      safetyControls.updatePolicy({ outreachKillSwitch: false, isDryRun: false });
      (config as any).OUTREACH_ENABLED = true;
      (config as any).LIVE_PILOT_ENABLED = true;
      (config as any).DRY_RUN = false;

      const report = await service.executePilot({
        campaignId: testCampaignId,
        confirm: false, // missing confirm
        live: true,
        allowTestRecord: true,
      });

      expect(report.sent).toBe(0);
      expect(report.message).toContain('explicit --confirm flag required');
    } finally {
      safetyControls.updatePolicy({ outreachKillSwitch: originalKillSwitch, isDryRun: originalDryRun });
      (config as any).OUTREACH_ENABLED = originalOutreach;
      (config as any).LIVE_PILOT_ENABLED = originalPilot;
      (config as any).DRY_RUN = originalDryRun;
    }
  });

  // 6. Live requires explicit --live flag
  it('6. live execution requires explicit --live flag', async () => {
    await createCandidateFixture({ name: 'LiveFlagTestBiz' });
    const service = new PilotExecutionService(db, validator);

    const originalKillSwitch = safetyControls.isKillSwitchActive();
    const originalOutreach = config.OUTREACH_ENABLED;
    const originalPilot = config.LIVE_PILOT_ENABLED;
    const originalDryRun = config.DRY_RUN;

    try {
      safetyControls.updatePolicy({ outreachKillSwitch: false, isDryRun: false });
      (config as any).OUTREACH_ENABLED = true;
      (config as any).LIVE_PILOT_ENABLED = true;
      (config as any).DRY_RUN = false;

      const report = await service.executePilot({
        campaignId: testCampaignId,
        confirm: true,
        live: false, // missing --live
        allowTestRecord: true,
      });

      expect(report.sent).toBe(0);
      expect(report.message).toContain('LIVE_FLAG_REQUIRED');
    } finally {
      safetyControls.updatePolicy({ outreachKillSwitch: originalKillSwitch, isDryRun: originalDryRun });
      (config as any).OUTREACH_ENABLED = originalOutreach;
      (config as any).LIVE_PILOT_ENABLED = originalPilot;
      (config as any).DRY_RUN = originalDryRun;
    }
  });

  // 7. Live requires verified provenance
  it('7. live requires verified public provenance; unverified contact is blocked', async () => {
    const unverified = await createCandidateFixture({
      name: 'UnverifiedBiz',
      isVerified: false,
      sourceUrl: '',
      contactStatus: 'DISCOVERED',
    });

    const eligibility = await validator.isLivePilotEligible(unverified.outreach.id, {
      checkEnvFlags: false,
      dryRun: false,
      allowTestRecord: true,
      requireStrictProvenance: true,
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toContain('EMAIL_SOURCE_NOT_VERIFIABLE');
  });

  // 8. Live requires campaign match
  it('8. live requires campaign membership match', async () => {
    const otherCampaign = await db.campaign.create({
      data: { name: `Other Campaign ${testSuffix}`, country: 'US', city: 'Dallas', state: 'TX', niche: 'Dentist' },
    });

    const candidate = await createCandidateFixture({
      name: 'OtherCampaignBiz',
      campaignId: otherCampaign.id,
    });

    const eligibility = await validator.isLivePilotEligible(candidate.outreach.id, {
      checkEnvFlags: false,
      dryRun: false,
      campaignId: testCampaignId, // Target is Dallas pilot
      allowTestRecord: true,
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.some((r) => r.includes('CAMPAIGN'))).toBe(true);
  });

  // 9. Live requires compliance footer
  it('9. live requires compliance footer (unsubscribe/opt-out)', async () => {
    const candidate = await createCandidateFixture({
      name: 'NoOptOutBiz',
      body: 'Hello Team, your website has issues. Please reply.',
    });

    const eligibility = await validator.isLivePilotEligible(candidate.outreach.id, {
      checkEnvFlags: false,
      dryRun: false,
      allowTestRecord: true,
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toContain('OPT_OUT_FOOTER_REQUIRED');
  });

  // 10. Live requires valid postal address
  it('10. live requires valid physical postal address in configuration and body', async () => {
    const candidate = await createCandidateFixture({
      name: 'NoPostalBiz',
      body: 'Hello Team,\n\nMobile issues found.\n\nReply unsubscribe to opt out.', // No postal address in body
    });

    const eligibility = await validator.isLivePilotEligible(candidate.outreach.id, {
      checkEnvFlags: false,
      dryRun: false,
      allowTestRecord: true,
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toContain('SENDER_POSTAL_ADDRESS_MISSING_FROM_BODY');
  });

  // 11. Suppressed candidate is blocked
  it('11. suppressed candidate is strictly blocked from live sending', async () => {
    const candidate = await createCandidateFixture({
      name: 'SuppressedBiz',
      email: `suppressed-${cleanSuffix}@example.com`,
    });

    await db.suppression.create({
      data: {
        targetType: 'EMAIL',
        targetValue: candidate.outreach.primaryContactValue!,
        reason: 'OPTOUT_REQUESTED',
      },
    });

    const eligibility = await validator.isLivePilotEligible(candidate.outreach.id, {
      checkEnvFlags: false,
      dryRun: false,
      allowTestRecord: true,
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toContain('SUPPRESSED_RECIPIENT');
  });

  // 12. Changed content after approval blocked
  it('12. content changed after human approval must be blocked with CONTENT_CHANGED_AFTER_APPROVAL', async () => {
    const candidate = await createCandidateFixture({
      name: 'MutatedContentBiz',
    });

    // Artificially alter the body in DB without re-approval / updating hash
    await db.outreach.update({
      where: { id: candidate.outreach.id },
      data: { body: candidate.outreach.body + '\n\nP.S. Unapproved promotional discount added!' },
    });

    const eligibility = await validator.isLivePilotEligible(candidate.outreach.id, {
      checkEnvFlags: false,
      dryRun: false,
      allowTestRecord: true,
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toContain('CONTENT_CHANGED_AFTER_APPROVAL');
  });

  // 13. SMTP password never appears in output or error representations
  it('13. SMTP password never appears in output or error representations', async () => {
    const service = new PilotExecutionService(db, validator);
    const report = await service.executePilot({
      campaignId: testCampaignId,
      limit: 1,
      confirm: true,
      dryRun: true,
      allowTestRecord: true,
    });
    const serializedReport = JSON.stringify(report);
    expect(serializedReport).not.toContain(process.env.SMTP_PASSWORD || 'mljrttaggfdogvfu');
  });

  // 14. SMTP success is not labeled DELIVERED
  it('14. successful SMTP send must be recorded as SENT, not DELIVERED', async () => {
    await createCandidateFixture({ name: 'SmtpLabelBiz' });

    const mockSmtp = {
      name: 'SmtpDeliveryProvider',
      isNetworkTransport: true,
      isAvailable: async () => true,
      send: vi.fn().mockResolvedValue({
        success: true,
        status: 'SENT',
        messageId: 'smtp-label-test-msg',
        attemptedAt: new Date(),
        providerName: 'SmtpDeliveryProvider',
        dryRun: false,
      }),
      getCapabilities: () => ({ supportsHtml: true, supportsAttachments: false }),
    } as unknown as SmtpDeliveryProvider;

    const liveService = new PilotExecutionService(db, validator, mockSmtp);

    const originalKillSwitch = safetyControls.isKillSwitchActive();
    const originalOutreach = config.OUTREACH_ENABLED;
    const originalPilot = config.LIVE_PILOT_ENABLED;
    const originalDryRun = config.DRY_RUN;

    try {
      safetyControls.updatePolicy({ outreachKillSwitch: false, isDryRun: false });
      (config as any).OUTREACH_ENABLED = true;
      (config as any).LIVE_PILOT_ENABLED = true;
      (config as any).DRY_RUN = false;

      const report = await liveService.executePilot({
        campaignId: testCampaignId,
        limit: 1,
        confirm: true,
        live: true,
        allowTestRecord: true,
      });

      expect(report.sent).toBe(1);
      expect(report.results[0].status).toBe('SENT');
      expect(report.results[0].status).not.toBe('DELIVERED');
    } finally {
      safetyControls.updatePolicy({ outreachKillSwitch: originalKillSwitch, isDryRun: originalDryRun });
      (config as any).OUTREACH_ENABLED = originalOutreach;
      (config as any).LIVE_PILOT_ENABLED = originalPilot;
      (config as any).DRY_RUN = originalDryRun;
    }
  });

  // 15 & 16. SMTP failure halts immediately without retry and without fallback to candidate #2
  it('15 & 16. SMTP failure halts immediately without retry and without fallback to candidate #2', async () => {
    const c1 = await createCandidateFixture({ name: 'FailBiz', category: 'HVAC' });
    const c2 = await createCandidateFixture({ name: 'UntouchedBiz', category: 'Dentist' });

    const mockFailingSmtp = {
      name: 'SmtpDeliveryProvider',
      isNetworkTransport: true,
      isAvailable: async () => true,
      send: vi.fn().mockRejectedValue(new Error('Connection timeout to SMTP server')),
      getCapabilities: () => ({ supportsHtml: true, supportsAttachments: false }),
    } as unknown as SmtpDeliveryProvider;

    const liveService = new PilotExecutionService(db, validator, mockFailingSmtp);

    const originalKillSwitch = safetyControls.isKillSwitchActive();
    const originalOutreach = config.OUTREACH_ENABLED;
    const originalPilot = config.LIVE_PILOT_ENABLED;
    const originalDryRun = config.DRY_RUN;

    try {
      safetyControls.updatePolicy({ outreachKillSwitch: false, isDryRun: false });
      (config as any).OUTREACH_ENABLED = true;
      (config as any).LIVE_PILOT_ENABLED = true;
      (config as any).DRY_RUN = false;

      const report = await liveService.executePilot({
        campaignId: testCampaignId,
        limit: 2,
        confirm: true,
        live: true,
        allowTestRecord: true,
      });

      // Exactly 1 attempt made
      expect(mockFailingSmtp.send).toHaveBeenCalledTimes(1);
      expect(report.sent).toBe(0);

      // Candidate 2 untouched
      const updatedC2 = await db.outreach.findUnique({ where: { id: c2.outreach.id } });
      expect(updatedC2?.status).toBe('READY_TO_SEND');
      expect(updatedC2?.sentAt).toBeNull();
    } finally {
      safetyControls.updatePolicy({ outreachKillSwitch: originalKillSwitch, isDryRun: originalDryRun });
      (config as any).OUTREACH_ENABLED = originalOutreach;
      (config as any).LIVE_PILOT_ENABLED = originalPilot;
      (config as any).DRY_RUN = originalDryRun;
    }
  });

  // 17. Automatic follow-up remains disabled
  it('17. automatic follow-up remains disabled by default', () => {
    expect(config.AUTO_FOLLOWUP_ENABLED).toBe(false);
  });

  // 18. Current safety flags cause live send to remain hard blocked
  it('18. current safety flags cause live send to remain hard blocked', async () => {
    await createCandidateFixture({ name: 'BlockedSafetyBiz' });
    const service = new PilotExecutionService(db, validator);

    // Run without overriding any environment flags or kill switch
    const report = await service.executePilot({
      campaignId: testCampaignId,
      limit: 1,
      confirm: true,
      live: true,
      allowTestRecord: true,
    });

    expect(report.sent).toBe(0);
    expect(report.message).toContain('OUTREACH KILL SWITCH ACTIVE');
  });
});
