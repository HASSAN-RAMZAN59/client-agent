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

describe('Outbound Provider Policy Gate & Safety Verification Tests', () => {
  let testCampaignId: string;
  let testSuffix: string;
  let cleanSuffix: string;
  const validator = new PreSendValidator(db);

  beforeEach(async () => {
    testSuffix = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    cleanSuffix = testSuffix.replace(/[^a-zA-Z0-9]/g, '');

    const campaign = await db.campaign.create({
      data: {
        name: `Dallas Provider Policy Gate ${testSuffix}`,
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
        leadOpportunityScore: 85,
        overallScore: 85,
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
        dryRun: true,
      },
    });

    return { biz, lead, outreach };
  }

  // 1. Personal Gmail SMTP capability metadata
  it('1. SmtpDeliveryProvider detects personal Gmail and sets supportsCommercialColdOutreach=false', () => {
    const smtpProvider = new SmtpDeliveryProvider();
    const caps = smtpProvider.getCapabilities();

    expect(caps.providerType).toBe('GMAIL_SMTP');
    expect(caps.supportsCommercialColdOutreach).toBe(false);
    expect(caps.providerPolicyStatus).toBe('UNSUPPORTED');

    const statusCheck = smtpProvider.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' });
    expect(statusCheck.status).toBe('UNSUPPORTED');
    expect(statusCheck.reasonCode).toBe('OUTBOUND_PROVIDER_POLICY_UNSUPPORTED');
  });

  // 2. Personal Gmail SMTP cold commercial live send is blocked at transport level
  it('2. SmtpDeliveryProvider.send blocks live cold commercial outreach with OUTBOUND_PROVIDER_POLICY_UNSUPPORTED', async () => {
    const smtpProvider = new SmtpDeliveryProvider();
    
    // Attempt live send (dryRun=false)
    const result = await smtpProvider.send({
      outreachId: 'mock-outreach-id',
      leadId: 'mock-lead-id',
      businessId: 'mock-biz-id',
      businessName: 'Test Target Business',
      recipient: 'target@example.com',
      recipientType: 'EMAIL',
      subject: 'Test Subject',
      body: 'Test Body',
      dryRun: false,
      outreachType: 'COLD_COMMERCIAL',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('OUTBOUND_PROVIDER_POLICY_UNSUPPORTED');
  });

  // 3. Dry-run still succeeds through PilotExecutionService with 2 simulated sends and 0 network sends
  it('3. dry-run still succeeds with 2 simulated sends and 0 network sends', async () => {
    const cand1 = await createCandidateFixture({ name: 'SimulatedBizOne' });
    const cand2 = await createCandidateFixture({ name: 'SimulatedBizTwo' });

    const executor = new PilotExecutionService(db, validator);
    const report = await executor.executePilot({
      campaignId: testCampaignId,
      limit: 2,
      confirm: true,
      dryRun: true,
      allowTestRecord: true,
    });

    expect(report.confirmed).toBe(true);
    expect(report.sent).toBe(0); // ZERO real network sends
    expect(report.simulated).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.message).toContain('DRY RUN — ZERO REAL MESSAGES SENT');

    // Candidate statuses remain preserved
    const o1 = await db.outreach.findUnique({ where: { id: cand1.outreach.id } });
    const o2 = await db.outreach.findUnique({ where: { id: cand2.outreach.id } });
    expect(o1?.status).toBe('READY_TO_SEND');
    expect(o2?.status).toBe('READY_TO_SEND');
  });

  // 4. Gmail credentials remain completely secret
  it('4. Gmail credentials remain completely secret and unexposed in settings summary', () => {
    const smtpProvider = new SmtpDeliveryProvider();
    const summary = smtpProvider.getSettingsSummary();

    expect(summary.configured).toBe('YES');
    expect(summary.networkCapable).toBe('YES');
    expect(summary.coldCommercialOutreachEligible).toBe('NO');
    expect(summary.providerType).toBe('GMAIL_SMTP');
    expect(summary.providerPolicyStatus).toBe('UNSUPPORTED');

    // Ensure password and credentials are never part of summary object
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(config.SMTP_PASSWORD);
    expect(serialized).not.toContain('pass');
    expect(serialized).not.toContain('auth');
  });

  // 5. Unknown provider policy defaults to REVIEW_REQUIRED
  it('5. unknown or custom SMTP provider defaults to REVIEW_REQUIRED, not automatically allowed', () => {
    const customSmtp = new SmtpDeliveryProvider();
    vi.spyOn(customSmtp, 'isPersonalGmail').mockReturnValue(false);
    vi.spyOn(customSmtp, 'isGoogleInfrastructure').mockReturnValue(false);

    const caps = customSmtp.getCapabilities();
    expect(caps.providerType).toBe('CUSTOM_SMTP');
    expect(caps.supportsCommercialColdOutreach).toBe(false);
    expect(caps.providerPolicyStatus).toBe('REVIEW_REQUIRED');

    const statusCheck = customSmtp.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' });
    expect(statusCheck.status).toBe('REVIEW_REQUIRED');
    expect(statusCheck.reasonCode).toBe('PROVIDER_POLICY_REVIEW_REQUIRED');
  });

  // 6. Provider-policy gate cannot be bypassed with --live, --confirm, or limit=1
  it('6. provider-policy gate cannot be bypassed with --live, --confirm, or limit=1', async () => {
    const cand1 = await createCandidateFixture({ name: 'BypassAttemptBiz1' });
    const cand2 = await createCandidateFixture({ name: 'BypassAttemptBiz2' });

    // Mock live mode flags in safetyControls
    safetyControls.updatePolicy({ outreachKillSwitch: false, isDryRun: false });
    const originalOutreachEnabled = config.OUTREACH_ENABLED;
    const originalLivePilot = config.LIVE_PILOT_ENABLED;
    const originalDryRun = config.DRY_RUN;

    try {
      (config as any).OUTREACH_ENABLED = true;
      (config as any).LIVE_PILOT_ENABLED = true;
      (config as any).DRY_RUN = false;

      const executor = new PilotExecutionService(db, validator);

      // Attempt live send with --confirm, --live, --limit 1
      const report = await executor.executePilot({
        campaignId: testCampaignId,
        limit: 1,
        confirm: true,
        live: true,
        dryRun: false,
        allowTestRecord: true,
      });

      expect(report.sent).toBe(0); // ZERO REAL EMAILS SENT
      expect(report.simulated).toBe(0);
      expect(report.message).toContain('OUTBOUND_PROVIDER_POLICY_UNSUPPORTED');

      // Candidate approvals remain preserved
      const refreshed1 = await db.outreach.findUnique({ where: { id: cand1.outreach.id } });
      const refreshed2 = await db.outreach.findUnique({ where: { id: cand2.outreach.id } });
      expect(refreshed1?.status).toBe('READY_TO_SEND');
      expect(refreshed2?.status).toBe('READY_TO_SEND');
    } finally {
      (config as any).OUTREACH_ENABLED = originalOutreachEnabled;
      (config as any).LIVE_PILOT_ENABLED = originalLivePilot;
      (config as any).DRY_RUN = originalDryRun;
      safetyControls.updatePolicy({ outreachKillSwitch: true, isDryRun: true });
    }
  });

  // 7. Candidate #2 remains completely unsent
  it('7. candidate #2 remains unsent if live dispatch is evaluated', async () => {
    const cand1 = await createCandidateFixture({ name: 'FirstCandidateBiz' });
    const cand2 = await createCandidateFixture({ name: 'SecondCandidateBiz' });

    safetyControls.updatePolicy({ outreachKillSwitch: false, isDryRun: false });
    const originalOutreachEnabled = config.OUTREACH_ENABLED;
    const originalLivePilot = config.LIVE_PILOT_ENABLED;
    const originalDryRun = config.DRY_RUN;

    try {
      (config as any).OUTREACH_ENABLED = true;
      (config as any).LIVE_PILOT_ENABLED = true;
      (config as any).DRY_RUN = false;

      const executor = new PilotExecutionService(db, validator);

      await executor.executePilot({
        campaignId: testCampaignId,
        limit: 2,
        confirm: true,
        live: true,
        dryRun: false,
        allowTestRecord: true,
      });

      const o2 = await db.outreach.findUnique({ where: { id: cand2.outreach.id } });
      expect(o2?.status).toBe('READY_TO_SEND');
      expect(o2?.sentAt).toBeNull();
    } finally {
      (config as any).OUTREACH_ENABLED = originalOutreachEnabled;
      (config as any).LIVE_PILOT_ENABLED = originalLivePilot;
      (config as any).DRY_RUN = originalDryRun;
      safetyControls.updatePolicy({ outreachKillSwitch: true, isDryRun: true });
    }
  });

  // 8. Transactional and permitted provider use is not incorrectly classified as cold outreach
  it('8. transactional / inbound response provider use is permitted under Gmail policy', () => {
    const smtpProvider = new SmtpDeliveryProvider();
    
    const transactionalCheck = smtpProvider.getProviderPolicyStatus({ outreachType: 'TRANSACTIONAL' });
    expect(transactionalCheck.status).toBe('PERMITTED');

    const replyCheck = smtpProvider.getProviderPolicyStatus({ outreachType: 'REPLY' });
    expect(replyCheck.status).toBe('PERMITTED');

    const personalCheck = smtpProvider.getProviderPolicyStatus({ outreachType: 'PERSONAL' });
    expect(personalCheck.status).toBe('PERMITTED');
  });

  // 9. PreSendValidator enforces both LEGAL_COMPLIANCE_VALID and PROVIDER_POLICY_VALID
  it('9. PreSendValidator requires both legal compliance and provider policy for live mode', async () => {
    const cand = await createCandidateFixture({ name: 'ValidationCheckBiz' });

    // Live mode check with personal Gmail provider
    const eligibility = await validator.isLivePilotEligible(cand.outreach.id, {
      checkProviderPolicy: true,
      dryRun: false,
      allowTestRecord: true,
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toContain('OUTBOUND_PROVIDER_POLICY_UNSUPPORTED');
    expect(eligibility.details.legalComplianceValid).toBe(true);
    expect(eligibility.details.providerPolicyValid).toBe(false);
  });

  // 10. Existing Pilot Data for Chapman Air & Heat and Dallas Dental Specialists remains untouched
  it('10. Chapman Air & Heat and Dallas Dental Specialists remain in READY_TO_SEND and APPROVED status', async () => {
    const chapmanDraft = await db.outreach.findUnique({
      where: { id: '0435b4ba-e800-437a-b763-e03d8c2074c3' },
    });
    expect(chapmanDraft).not.toBeNull();
    expect(chapmanDraft?.status).toBe('READY_TO_SEND');
    expect(chapmanDraft?.approvedAt).not.toBeNull();
    expect(chapmanDraft?.sentAt).toBeNull();

    const ddsDraft = await db.outreach.findUnique({
      where: { id: '4da6b7e8-7e3e-451b-b5b2-ca91d275a91b' },
    });
    expect(ddsDraft).not.toBeNull();
    expect(ddsDraft?.status).toBe('READY_TO_SEND');
    expect(ddsDraft?.approvedAt).not.toBeNull();
    expect(ddsDraft?.sentAt).toBeNull();
  });
});
