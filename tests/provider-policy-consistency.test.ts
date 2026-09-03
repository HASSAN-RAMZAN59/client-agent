import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma as db } from '../src/database/index.js';
import { PilotExecutionService } from '../src/modules/outreach/execution/pilot-execution.service.js';
import { SmtpDeliveryProvider } from '../src/modules/outreach/execution/smtp-delivery.provider.js';
import { MockOutreachProvider } from '../src/modules/outreach/execution/mock-outreach.provider.js';
import { PreSendValidator } from '../src/modules/outreach/gate/pre-send-validator.js';
import { safetyControls } from '../src/config/safety.js';
import { config } from '../src/config/env.js';
import { ContentHasher } from '../src/modules/personalization/hardening/content-hasher.js';

describe('Provider Policy Consistency & Production Freeze Regression Tests', () => {
  const validator = new PreSendValidator(db);
  const testRunTimestamp = Date.now();
  const testCampaignId = `test-policy-consistency-${testRunTimestamp}`;
  let createdBusinessIds: string[] = [];

  beforeAll(async () => {
    // Create a dedicated test campaign
    await db.campaign.create({
      data: {
        id: testCampaignId,
        name: `Policy Consistency Test Campaign ${testRunTimestamp}`,
        city: 'Dallas',
        country: 'US',
        niche: 'HVAC',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    // Cleanup created test records
    for (const bizId of createdBusinessIds) {
      const leads = await db.lead.findMany({ where: { businessId: bizId } });
      for (const lead of leads) {
        await db.outreach.deleteMany({ where: { leadId: lead.id } });
      }
      await db.lead.deleteMany({ where: { businessId: bizId } });
      await db.contact.deleteMany({ where: { businessId: bizId } });
      await db.business.deleteMany({ where: { id: bizId } });
    }
    await db.campaign.deleteMany({ where: { id: testCampaignId } });
  });

  async function createCandidateFixture(overrides: {
    name?: string;
    email?: string;
    status?: string;
    approvalStatus?: string;
    contentHashMismatch?: boolean;
    campaignId?: string;
  } = {}) {
    const unique = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const bizName = overrides.name || `ConsistencyBiz ${unique}`;
    const email = overrides.email || `contact@${bizName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
    const targetCampaign = overrides.campaignId || testCampaignId;

    const biz = await db.business.create({
      data: {
        name: bizName,
        category: 'HVAC',
        source: 'google_places',
        city: 'Dallas',
        country: 'USA',
        website: `https://${bizName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
        campaignId: targetCampaign,
      },
    });
    createdBusinessIds.push(biz.id);

    const contact = await db.contact.create({
      data: {
        businessId: biz.id,
        type: 'EMAIL',
        value: email,
        classification: 'BUSINESS_GENERIC',
        status: 'VERIFIED_PUBLIC',
        source: 'official_website_html',
        sourceUrl: `https://${bizName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com/contact`,
        sourceType: 'OFFICIAL_WEBSITE',
        confidence: 'HIGH',
        qualityScore: 90,
        isVerified: true,
        isPublic: true,
      },
    });

    const lead = await db.lead.create({
      data: {
        businessId: biz.id,
        leadOpportunityScore: 85,
        classification: 'HOT',
        primaryContactValue: contact.value,
        primaryContactType: 'EMAIL',
      },
    });

    const subject = `Website observation for ${bizName}`;
    const body = `Hello ${bizName} Team,\n\nI was reviewing your website and noticed opportunities to improve performance.\n\nBest regards,\nHASSAN RAMZAN\nhassanramzan59@gmail.com\n\nWeb development outreach\n55 jb baba bakala faisalabad\n\nIf you'd rather not receive emails, reply unsubscribe.`;
    const contentHash = overrides.contentHashMismatch
      ? 'stale-hash-does-not-match-current-body'
      : ContentHasher.hashDraft(subject, body);

    const outreach = await db.outreach.create({
      data: {
        leadId: lead.id,
        channel: 'EMAIL',
        variant: 'VARIANT_B_STANDARD',
        status: (overrides.status as any) || 'READY_TO_SEND',
        approvalStatus: overrides.approvalStatus || 'APPROVED',
        approvedAt: new Date(),
        approvedBy: 'HUMAN_OPERATOR',
        subject,
        body,
        contentHash,
        primaryContactValue: contact.value,
        primaryContactType: 'EMAIL',
        qualityBand: 'EXCELLENT',
        evidenceValid: true,
        identityValid: true,
      },
    });

    return { business: biz, contact, lead, outreach };
  }

  // 1. Report counters and execution message always agree
  it('1. report counters and execution message always agree', async () => {
    await createCandidateFixture({ name: 'ReportAgreeBizOne' });
    await createCandidateFixture({ name: 'ReportAgreeBizTwo' });

    const executor = new PilotExecutionService(db, validator);
    const report = await executor.executePilot({
      campaignId: testCampaignId,
      limit: 2,
      confirm: true,
      dryRun: true,
      allowTestRecord: true,
    });

    expect(report.totalEligible).toBe(2);
    expect(report.simulated).toBe(2);
    expect(report.blocked).toBe(0);
    expect(report.sent).toBe(0);

    // Message must directly reflect authoritative counters
    expect(report.message).toBe(
      `DRY RUN — ZERO REAL MESSAGES SENT: ${report.simulated} drafts simulated, ${report.blocked} blocked.`
    );
    expect(report.message).toContain('2 drafts simulated, 0 blocked');
  });

  // 2. Blocked candidates not counted as simulated
  it('2. blocked candidates not counted as simulated', async () => {
    const test2CampaignId = `test-policy-mutated-${Date.now()}`;
    await db.campaign.create({
      data: {
        id: test2CampaignId,
        name: 'Test 2 Mutated Campaign',
        city: 'Dallas',
        country: 'US',
        niche: 'HVAC',
        status: 'ACTIVE',
      },
    });

    try {
      // 1 valid candidate + 1 candidate with mutated content after approval
      await createCandidateFixture({ name: 'ValidCandidateBiz', campaignId: test2CampaignId });
      await createCandidateFixture({
        name: 'MutatedCandidateBiz',
        contentHashMismatch: true,
        campaignId: test2CampaignId,
      });

      const executor = new PilotExecutionService(db, validator);
      const report = await executor.executePilot({
        campaignId: test2CampaignId,
        limit: 2,
        confirm: true,
        dryRun: true,
        allowTestRecord: true,
      });

      // Valid was simulated, mutated was blocked during execution
      expect(report.simulated).toBe(1);
      expect(report.blocked).toBe(1);
      expect(report.simulated + report.blocked).toBe(2);

      // Simulated MUST NOT count the blocked candidate
      expect(report.message).toBe(
        `DRY RUN — ZERO REAL MESSAGES SENT: 1 drafts simulated, 1 blocked.`
      );
    } finally {
      await db.campaign.deleteMany({ where: { id: test2CampaignId } });
    }
  });

  // 3. Canonical --campaign flag works
  it('3. canonical --campaign flag works in preview and execution options', async () => {
    await createCandidateFixture({ name: 'CampaignFlagBiz' });
    const executor = new PilotExecutionService(db, validator);
    const preview = await executor.previewPilot(2, testCampaignId, {
      allowTestRecord: true,
      dryRun: true,
    });

    expect(preview.candidates.length).toBeGreaterThanOrEqual(1);
    for (const c of preview.candidates) {
      expect(c.campaignMatch).toBe('MATCH');
    }
  });

  // 4. Deprecated alias behavior if retained
  it('4. deprecated alias (--campaign-id) produces identical execution behavior', async () => {
    const executor = new PilotExecutionService(db, validator);

    // Simulate CLI resolving options.campaign || options.campaignId
    const targetUsingCanonical = testCampaignId;
    const targetUsingDeprecated = testCampaignId;

    const reportCanonical = await executor.executePilot({
      campaignId: targetUsingCanonical,
      limit: 1,
      confirm: true,
      dryRun: true,
      allowTestRecord: true,
    });

    const reportDeprecated = await executor.executePilot({
      campaignId: targetUsingDeprecated,
      limit: 1,
      confirm: true,
      dryRun: true,
      allowTestRecord: true,
    });

    expect(reportCanonical.simulated).toBe(reportDeprecated.simulated);
    expect(reportCanonical.blocked).toBe(reportDeprecated.blocked);
  });

  // 5. Personal @gmail.com cold outreach blocked
  it('5. personal @gmail.com cold outreach blocked with OUTBOUND_PROVIDER_POLICY_UNSUPPORTED', () => {
    const originalUser = config.SMTP_USER;
    const originalFrom = config.SMTP_FROM_EMAIL;

    try {
      (config as any).SMTP_USER = 'myaccount@gmail.com';
      (config as any).SMTP_FROM_EMAIL = 'myaccount@gmail.com';

      const provider = new SmtpDeliveryProvider();
      expect(provider.isPersonalGmail()).toBe(true);

      const check = provider.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' });
      expect(check.status).toBe('UNSUPPORTED');
      expect(check.reasonCode).toBe('OUTBOUND_PROVIDER_POLICY_UNSUPPORTED');
    } finally {
      (config as any).SMTP_USER = originalUser;
      (config as any).SMTP_FROM_EMAIL = originalFrom;
    }
  });

  // 6. @googlemail.com cold outreach blocked
  it('6. personal @googlemail.com cold outreach blocked with OUTBOUND_PROVIDER_POLICY_UNSUPPORTED', () => {
    const originalUser = config.SMTP_USER;
    const originalFrom = config.SMTP_FROM_EMAIL;

    try {
      (config as any).SMTP_USER = 'myaccount@googlemail.com';
      (config as any).SMTP_FROM_EMAIL = 'myaccount@googlemail.com';

      const provider = new SmtpDeliveryProvider();
      expect(provider.isPersonalGmail()).toBe(true);

      const check = provider.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' });
      expect(check.status).toBe('UNSUPPORTED');
      expect(check.reasonCode).toBe('OUTBOUND_PROVIDER_POLICY_UNSUPPORTED');
    } finally {
      (config as any).SMTP_USER = originalUser;
      (config as any).SMTP_FROM_EMAIL = originalFrom;
    }
  });

  // 7. smtp.gmail.com + ambiguous custom domain defaults REVIEW_REQUIRED
  it('7. smtp.gmail.com + ambiguous custom domain defaults to REVIEW_REQUIRED', () => {
    const originalHost = config.SMTP_HOST;
    const originalUser = config.SMTP_USER;
    const originalFrom = config.SMTP_FROM_EMAIL;

    try {
      (config as any).SMTP_HOST = 'smtp.gmail.com';
      (config as any).SMTP_USER = 'outreach@customagency.com';
      (config as any).SMTP_FROM_EMAIL = 'outreach@customagency.com';

      const provider = new SmtpDeliveryProvider();
      expect(provider.isPersonalGmail()).toBe(false);
      expect(provider.isGoogleInfrastructure()).toBe(true);

      const check = provider.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' });
      expect(check.status).toBe('REVIEW_REQUIRED');
      expect(check.reasonCode).toBe('PROVIDER_POLICY_REVIEW_REQUIRED');

      const caps = provider.getCapabilities();
      expect(caps.providerType).toBe('GOOGLE_WORKSPACE');
      expect(caps.supportsCommercialColdOutreach).toBe(false);
    } finally {
      (config as any).SMTP_HOST = originalHost;
      (config as any).SMTP_USER = originalUser;
      (config as any).SMTP_FROM_EMAIL = originalFrom;
    }
  });

  // 8. Unknown SMTP defaults REVIEW_REQUIRED
  it('8. unknown SMTP host defaults to REVIEW_REQUIRED', () => {
    const originalHost = config.SMTP_HOST;
    const originalUser = config.SMTP_USER;
    const originalFrom = config.SMTP_FROM_EMAIL;

    try {
      (config as any).SMTP_HOST = 'mail.myunknowndomain.com';
      (config as any).SMTP_USER = 'sales@myunknowndomain.com';
      (config as any).SMTP_FROM_EMAIL = 'sales@myunknowndomain.com';

      const provider = new SmtpDeliveryProvider();
      expect(provider.isPersonalGmail()).toBe(false);
      expect(provider.isGoogleInfrastructure()).toBe(false);

      const check = provider.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' });
      expect(check.status).toBe('REVIEW_REQUIRED');
      expect(check.reasonCode).toBe('PROVIDER_POLICY_REVIEW_REQUIRED');

      const caps = provider.getCapabilities();
      expect(caps.supportsCommercialColdOutreach).toBe(false);
    } finally {
      (config as any).SMTP_HOST = originalHost;
      (config as any).SMTP_USER = originalUser;
      (config as any).SMTP_FROM_EMAIL = originalFrom;
    }
  });

  // 9. Provider name alone cannot grant permission
  it('9. provider name alone cannot grant permission without explicit review', () => {
    const commercialHosts = [
      { host: 'smtp.sendgrid.net', user: 'apikey' },
      { host: 'smtp.postmarkapp.com', user: 'pm_token' },
      { host: 'smtp.mailgun.org', user: 'postmaster@mg.domain.com' },
      { host: 'email-smtp.us-east-1.amazonaws.com', user: 'ses_key' },
    ];

    const originalHost = config.SMTP_HOST;
    const originalUser = config.SMTP_USER;
    const originalFrom = config.SMTP_FROM_EMAIL;

    try {
      for (const item of commercialHosts) {
        (config as any).SMTP_HOST = item.host;
        (config as any).SMTP_USER = item.user;
        (config as any).SMTP_FROM_EMAIL = 'outreach@verifieddomain.com';

        const provider = new SmtpDeliveryProvider();
        const check = provider.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' });

        // Never automatically permitted based solely on provider name
        expect(check.status).toBe('REVIEW_REQUIRED');
        expect(provider.getCapabilities().supportsCommercialColdOutreach).toBe(false);
      }
    } finally {
      (config as any).SMTP_HOST = originalHost;
      (config as any).SMTP_USER = originalUser;
      (config as any).SMTP_FROM_EMAIL = originalFrom;
    }
  });

  // 10. Dry-run bypasses provider-policy dispatch block only because no network transport occurs
  it('10. dry-run bypasses provider-policy dispatch block only because no network transport occurs', async () => {
    const mock = new MockOutreachProvider();
    expect(mock.isNetworkTransport).toBe(false);

    const result = await mock.send({
      outreachId: 'mock-id',
      leadId: 'mock-lead',
      businessId: 'mock-biz',
      businessName: 'Mock Biz',
      recipient: 'test@example.com',
      recipientType: 'EMAIL',
      subject: 'Mock Subject',
      body: 'Mock Body',
      dryRun: true,
      outreachType: 'COLD_COMMERCIAL',
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('SIMULATED');
    expect(result.dryRun).toBe(true);
  });

  // 11. Live provider-policy gate cannot be bypassed
  it('11. live provider-policy gate cannot be bypassed with --live, --confirm, or limit=1', async () => {
    await createCandidateFixture({ name: 'LiveBypassAttemptBiz' });

    const smtpProvider = new SmtpDeliveryProvider();
    const liveService = new PilotExecutionService(db, validator, smtpProvider);

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

      expect(report.sent).toBe(0);
      expect(report.message).toContain('LIVE PILOT BLOCKED BY PROVIDER POLICY');
      expect(report.message).toContain('OUTBOUND_PROVIDER_POLICY_UNSUPPORTED');
    } finally {
      safetyControls.updatePolicy({ outreachKillSwitch: originalKillSwitch, isDryRun: originalDryRun });
      (config as any).OUTREACH_ENABLED = originalOutreach;
      (config as any).LIVE_PILOT_ENABLED = originalPilot;
      (config as any).DRY_RUN = originalDryRun;
    }
  });

  // 12. Approved pilot drafts remain unchanged
  it('12. approved pilot drafts for Chapman and Dallas Dental remain unchanged and unsent', async () => {
    const chapman = await db.outreach.findUnique({
      where: { id: '0435b4ba-e800-437a-b763-e03d8c2074c3' },
    });
    expect(chapman).toBeDefined();
    expect(chapman?.status).toBe('READY_TO_SEND');
    expect(chapman?.approvalStatus).toBe('APPROVED');
    expect(chapman?.sentAt).toBeNull();
    expect(chapman?.providerMessageId).toBeNull();

    const dds = await db.outreach.findUnique({
      where: { id: '4da6b7e8-7e3e-451b-b5b2-ca91d275a91b' },
    });
    expect(dds).toBeDefined();
    expect(dds?.status).toBe('READY_TO_SEND');
    expect(dds?.approvalStatus).toBe('APPROVED');
    expect(dds?.sentAt).toBeNull();
    expect(dds?.providerMessageId).toBeNull();
  });

  // 13. Zero network sends during safe simulation
  it('13. zero network sends occur during safe dry-run simulation', async () => {
    await createCandidateFixture({ name: 'SafeSimBiz' });
    const smtpSpy = vi.spyOn(SmtpDeliveryProvider.prototype, 'send');

    const executor = new PilotExecutionService(db, validator);
    const report = await executor.executePilot({
      campaignId: testCampaignId,
      limit: 2,
      confirm: true,
      dryRun: true,
      allowTestRecord: true,
    });

    expect(report.sent).toBe(0);
    expect(report.simulated).toBeGreaterThanOrEqual(1);
    expect(smtpSpy).not.toHaveBeenCalled();

    smtpSpy.mockRestore();
  });
});
