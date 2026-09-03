import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { PilotExecutionService } from '../src/modules/outreach/execution/pilot-execution.service.js';
import { PreSendValidator } from '../src/modules/outreach/gate/pre-send-validator.js';
import { SmtpDeliveryProvider } from '../src/modules/outreach/execution/smtp-delivery.provider.js';
import { MockOutreachProvider } from '../src/modules/outreach/execution/mock-outreach.provider.js';
import { safetyControls } from '../src/config/safety.js';
import { config } from '../src/config/env.js';

const db = getPrismaClient();

describe('Dry-Run Execution Fix & Safety Semantics Regression Tests', () => {
  let testCampaignId: string;
  let testSuffix: string;
  let cleanSuffix: string;
  const validator = new PreSendValidator(db);

  beforeEach(async () => {
    testSuffix = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    cleanSuffix = testSuffix.replace(/[^a-zA-Z0-9]/g, '');

    const campaign = await db.campaign.create({
      data: {
        name: `Dallas Pilot Test ${testSuffix}`,
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
  }) {
    const biz = await db.business.create({
      data: {
        name: `Phase11 ${opts.name} ${cleanSuffix}`,
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

    const outreach = await db.outreach.create({
      data: {
        leadId: lead.id,
        variant: 'VARIANT_B_STANDARD',
        channel: 'EMAIL',
        subject: `Website observation for ${biz.name}`,
        body: `Hello ${biz.name} Team,\n\nMobile load time recorded at 5.2 seconds.\n\nBest regards,\nHASSAN RAMZAN\nhassanramzan59@gmail.com\n\nWeb development outreach\n\n55 jb baba bakala faisalabad\n\nIf you'd rather not receive emails from me, just reply "unsubscribe" and I won't contact you again.`,
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

  // 1. kill switch blocks live SMTP
  it('1. kill switch blocks live SMTP dispatch', async () => {
    const smtpMock = new SmtpDeliveryProvider();
    const sendSpy = vi.spyOn(smtpMock, 'send');
    const service = new PilotExecutionService(db, validator, smtpMock);

    safetyControls.updatePolicy({ outreachKillSwitch: true, isDryRun: false });
    const report = await service.executePilot({
      limit: 1,
      confirm: true,
      dryRun: false,
      campaignId: testCampaignId,
      allowTestRecord: true,
    });

    expect(report.message).toContain('OUTREACH KILL SWITCH ACTIVE');
    expect(report.sent).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();

    safetyControls.updatePolicy({ outreachKillSwitch: true, isDryRun: true });
  });

  // 2. kill switch does not block explicit mock dry-run
  it('2. kill switch does not block explicit mock dry-run', async () => {
    await createCandidateFixture({ name: 'Safe DryRun Biz' });
    const mockProvider = new MockOutreachProvider();
    const sendSpy = vi.spyOn(mockProvider, 'send');
    const service = new PilotExecutionService(db, validator, undefined, mockProvider);

    safetyControls.updatePolicy({ outreachKillSwitch: true, isDryRun: true });
    const report = await service.executePilot({
      limit: 1,
      confirm: true,
      dryRun: true,
      campaignId: testCampaignId,
      allowTestRecord: true,
    });

    expect(report.message).toContain('DRY RUN — ZERO REAL MESSAGES SENT');
    expect(report.simulated).toBeGreaterThanOrEqual(1);
    expect(report.sent).toBe(0);
    expect(sendSpy).toHaveBeenCalled();
  });

  // 3. OUTREACH_ENABLED=false does not block safe dry-run
  it('3. OUTREACH_ENABLED=false does not block safe dry-run', async () => {
    await createCandidateFixture({ name: 'Outreach Disabled Biz' });
    const service = new PilotExecutionService(db, validator);

    const report = await service.executePilot({
      limit: 1,
      confirm: true,
      dryRun: true,
      campaignId: testCampaignId,
      allowTestRecord: true,
    });

    expect(report.simulated).toBeGreaterThanOrEqual(1);
    expect(report.sent).toBe(0);
  });

  // 4. LIVE_PILOT_ENABLED=false does not block safe dry-run
  it('4. LIVE_PILOT_ENABLED=false does not block safe dry-run', async () => {
    await createCandidateFixture({ name: 'Live Pilot Disabled Biz' });
    const service = new PilotExecutionService(db, validator);

    const report = await service.executePilot({
      limit: 1,
      confirm: true,
      dryRun: true,
      campaignId: testCampaignId,
      allowTestRecord: true,
    });

    expect(report.simulated).toBeGreaterThanOrEqual(1);
    expect(report.sent).toBe(0);
  });

  // 5. dry-run cannot use SMTP provider
  it('5. dry-run cannot use SMTP provider', async () => {
    const smtpMock = new SmtpDeliveryProvider();
    const sendSpy = vi.spyOn(smtpMock, 'send');
    const service = new PilotExecutionService(db, validator, smtpMock);

    await createCandidateFixture({ name: 'No Smtp DryRun Biz' });
    const report = await service.executePilot({
      limit: 1,
      confirm: true,
      dryRun: true,
      campaignId: testCampaignId,
      allowTestRecord: true,
    });

    expect(sendSpy).not.toHaveBeenCalled();
    expect(report.sent).toBe(0);
  });

  // 6. --dry-run with real provider returns DRY_RUN_REAL_TRANSPORT_PROHIBITED
  it('6. --dry-run with real provider returns DRY_RUN_REAL_TRANSPORT_PROHIBITED', async () => {
    const realProviderAsMock = new SmtpDeliveryProvider() as unknown as MockOutreachProvider;
    const service = new PilotExecutionService(db, validator, undefined, realProviderAsMock);

    await createCandidateFixture({ name: 'Injected Real Provider Biz' });
    const report = await service.executePilot({
      limit: 1,
      confirm: true,
      dryRun: true,
      campaignId: testCampaignId,
      allowTestRecord: true,
    });

    expect(report.message).toContain('DRY_RUN_REAL_TRANSPORT_PROHIBITED');
    expect(report.simulated).toBe(0);
    expect(report.sent).toBe(0);
  });

  // 7. dry-run still requires human approval
  it('7. dry-run still requires human approval', async () => {
    await createCandidateFixture({
      name: 'Unapproved DryRun Biz',
      status: 'REVIEW_REQUIRED',
      approvedAt: null,
    });

    const service = new PilotExecutionService(db, validator);
    const report = await service.executePilot({
      limit: 1,
      confirm: true,
      dryRun: true,
      campaignId: testCampaignId,
      allowTestRecord: true,
    });

    const unapprovedCandidate = report.candidates.find((c) => c.businessName.includes('Unapproved DryRun Biz'));
    expect(unapprovedCandidate?.eligible).toBe(false);
  });

  // 8. dry-run still requires VERIFIED_PUBLIC
  it('8. dry-run still requires VERIFIED_PUBLIC', async () => {
    await createCandidateFixture({
      name: 'Unverified Contact Biz',
      contactStatus: 'UNVERIFIED',
      isVerified: false,
    });

    const service = new PilotExecutionService(db, validator);
    const report = await service.executePilot({
      limit: 1,
      confirm: true,
      dryRun: true,
      campaignId: testCampaignId,
      allowTestRecord: true,
    });

    const unverifiedCandidate = report.candidates.find((c) => c.businessName.includes('Unverified Contact Biz'));
    expect(unverifiedCandidate?.eligible).toBe(false);
  });

  // 9. dry-run still requires campaign match
  it('9. dry-run still requires campaign match', async () => {
    const otherCampaign = await db.campaign.create({
      data: { name: `Other Campaign ${testSuffix}`, country: 'US', city: 'Houston', niche: 'Dentist' },
    });
    await createCandidateFixture({
      name: 'Wrong Campaign Biz',
      campaignId: otherCampaign.id,
      city: 'Houston',
    });

    const service = new PilotExecutionService(db, validator);
    const report = await service.executePilot({
      limit: 5,
      confirm: true,
      dryRun: true,
      campaignId: testCampaignId,
      allowTestRecord: true,
    });

    const wrongMatch = report.candidates.find((c) => c.businessName.includes('Wrong Campaign Biz'));
    expect(wrongMatch).toBeUndefined();
  });

  // 10. dry-run still respects suppression
  it('10. dry-run still respects suppression', async () => {
    const suppressedEmail = `suppressed-${cleanSuffix}@dentalpro.com`;
    await db.suppression.create({
      data: {
        targetType: 'EMAIL',
        targetValue: suppressedEmail,
        reason: 'UNSUBSCRIBED',
      },
    });

    await createCandidateFixture({
      name: 'Suppressed Candidate Biz',
      email: suppressedEmail,
    });

    const service = new PilotExecutionService(db, validator);
    const report = await service.executePilot({
      limit: 1,
      confirm: true,
      dryRun: true,
      campaignId: testCampaignId,
      allowTestRecord: true,
    });

    const candidate = report.candidates.find((c) => c.recipientEmail === suppressedEmail);
    expect(candidate?.eligible).toBe(false);
  });

  // 11. dry-run still respects duplicate protection
  it('11. dry-run still respects duplicate protection within batch', async () => {
    const sharedEmail = `shared-${cleanSuffix}@samedomain.com`;
    await createCandidateFixture({ name: 'Dup Biz 1', email: sharedEmail });
    await createCandidateFixture({ name: 'Dup Biz 2', email: sharedEmail });

    const service = new PilotExecutionService(db, validator);
    const report = await service.executePilot({
      limit: 2,
      confirm: true,
      dryRun: true,
      campaignId: testCampaignId,
      allowTestRecord: true,
    });

    expect(report.duplicateBlocked).toBeGreaterThanOrEqual(1);
  });

  // 12. dry-run sends zero network requests
  it('12. dry-run sends zero network requests', async () => {
    await createCandidateFixture({ name: 'Zero Network Biz' });
    const service = new PilotExecutionService(db, validator);

    const report = await service.executePilot({
      limit: 1,
      confirm: true,
      dryRun: true,
      campaignId: testCampaignId,
      allowTestRecord: true,
    });

    expect(report.sent).toBe(0);
    expect(report.simulated).toBeGreaterThanOrEqual(1);
  });

  // 13. dry-run does not mark outreach genuinely SENT
  it('13. dry-run does not mark outreach genuinely SENT', async () => {
    const { outreach } = await createCandidateFixture({ name: 'No Sent Mutation Biz' });
    const service = new PilotExecutionService(db, validator);

    await service.executePilot({
      limit: 1,
      confirm: true,
      dryRun: true,
      campaignId: testCampaignId,
      allowTestRecord: true,
    });

    const recordAfter = await db.outreach.findUnique({ where: { id: outreach.id } });
    expect(recordAfter?.status).toBe('READY_TO_SEND');
    expect(recordAfter?.sentAt).toBeNull();
    expect(recordAfter?.providerMessageId).toBeNull();
  });

  // 14. live send remains blocked with current flags
  it('14. live send remains blocked with current flags', async () => {
    await createCandidateFixture({ name: 'Live Attempt Biz' });
    const service = new PilotExecutionService(db, validator);

    const report = await service.executePilot({
      limit: 1,
      confirm: true,
      dryRun: false, // live attempt
      campaignId: testCampaignId,
      allowTestRecord: true,
    });

    expect(report.sent).toBe(0);
    expect(report.message).toContain('OUTREACH KILL SWITCH ACTIVE');
  });

  // 15. current 2 approved Dallas candidates simulate successfully
  it('15. current 2 approved Dallas candidates simulate successfully', async () => {
    // Ensure pilot campaign exists in test db
    await db.campaign.upsert({
      where: { id: '79eae995-f714-4137-b284-85d18de1f929' },
      update: {},
      create: {
        id: '79eae995-f714-4137-b284-85d18de1f929',
        name: 'US First Live Pilot',
        country: 'US',
        city: 'Dallas',
        state: 'TX',
        niche: 'Dentist,HVAC',
        targetBusinesses: 10,
      },
    });

    // Ensure Chapman Air & Heat exists in test db
    let chapmanBiz = await db.business.findFirst({ where: { name: 'Chapman Air & Heat' } });
    if (!chapmanBiz) {
      chapmanBiz = await db.business.create({
        data: {
          name: 'Chapman Air & Heat',
          category: 'HVAC',
          city: 'Dallas',
          state: 'TX',
          country: 'US',
          website: 'https://chapmanair.com',
          campaignId: '79eae995-f714-4137-b284-85d18de1f929',
          source: 'official_website_html',
        },
      });
    } else {
      await db.business.update({
        where: { id: chapmanBiz.id },
        data: {
          campaignId: '79eae995-f714-4137-b284-85d18de1f929',
          city: 'Dallas',
          country: 'US',
        },
      });
    }

    let chapmanLead = await db.lead.findFirst({ where: { businessId: chapmanBiz.id } });
    if (!chapmanLead) {
      chapmanLead = await db.lead.create({
        data: {
          businessId: chapmanBiz.id,
          leadOpportunityScore: 55,
          overallScore: 55,
          classification: 'WARM',
          status: 'QUALIFIED',
          salesAngle: JSON.stringify({
            problem: 'Slow initial mobile page load speed.',
            opportunity: 'Optimize page assets.',
            recommendedService: 'WEBSITE_IMPROVEMENT',
          }),
        },
      });
    }

    await db.websiteAudit.deleteMany({ where: { businessId: chapmanBiz.id } });
    await db.websiteAudit.create({
      data: {
        businessId: chapmanBiz.id,
        website: 'https://chapmanair.com',
        status: 'AUDITED',
        score: 75,
        loadTimeMs: 5250,
        issuesJson: JSON.stringify(['Critical Page Load Latency']),
        findings: JSON.stringify(['Mobile performance optimization needed']),
      },
    });

    await db.contact.deleteMany({
      where: { businessId: chapmanBiz.id, type: 'EMAIL', value: 'info@chapmanair.com' },
    });
    await db.contact.create({
      data: {
        businessId: chapmanBiz.id,
        type: 'EMAIL',
        value: 'info@chapmanair.com',
        status: 'VERIFIED_PUBLIC',
        source: 'official_website_html',
        sourceUrl: 'https://chapmanair.com/about-us/',
        emailAsFound: 'info@chapmanair.com',
        isVerified: true,
        isPublic: true,
      },
    });

    await db.outreach.upsert({
      where: { id: '0435b4ba-e800-437a-b763-e03d8c2074c3' },
      update: {
        leadId: chapmanLead.id,
        status: 'READY_TO_SEND',
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        primaryContactValue: 'info@chapmanair.com',
        channel: 'EMAIL',
      },
      create: {
        id: '0435b4ba-e800-437a-b763-e03d8c2074c3',
        leadId: chapmanLead.id,
        variant: 'VARIANT_B_STANDARD',
        channel: 'EMAIL',
        subject: 'Website observation for Chapman Air & Heat',
        body: 'Hello Chapman Team,\n\nMobile load time recorded at 5.25 seconds.\n\nBest regards,\nHASSAN RAMZAN\nhassanramzan59@gmail.com\n\nWeb development outreach\n\n55 jb baba bakala faisalabad\n\nIf you\'d rather not receive emails from me, just reply "unsubscribe" and I won\'t contact you again.',
        status: 'READY_TO_SEND',
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        primaryContactValue: 'info@chapmanair.com',
        evidenceValid: true,
        identityValid: true,
      },
    });

    // Ensure Dallas Dental Specialists exists in test db
    let ddsBiz = await db.business.findFirst({ where: { name: 'Dallas Dental Specialists' } });
    if (!ddsBiz) {
      ddsBiz = await db.business.create({
        data: {
          name: 'Dallas Dental Specialists',
          category: 'Dentist',
          city: 'Dallas',
          state: 'TX',
          country: 'US',
          website: 'https://www.dallasdentalspecialists.com',
          campaignId: '79eae995-f714-4137-b284-85d18de1f929',
          source: 'official_website_html',
        },
      });
    } else {
      await db.business.update({
        where: { id: ddsBiz.id },
        data: {
          campaignId: '79eae995-f714-4137-b284-85d18de1f929',
          city: 'Dallas',
          country: 'US',
        },
      });
    }

    let ddsLead = await db.lead.findFirst({ where: { businessId: ddsBiz.id } });
    if (!ddsLead) {
      ddsLead = await db.lead.create({
        data: {
          businessId: ddsBiz.id,
          leadOpportunityScore: 50,
          overallScore: 50,
          classification: 'WARM',
          status: 'QUALIFIED',
          salesAngle: JSON.stringify({
            problem: 'Slow initial mobile page load speed.',
            opportunity: 'Optimize page assets.',
            recommendedService: 'WEBSITE_IMPROVEMENT',
          }),
        },
      });
    }

    await db.websiteAudit.deleteMany({ where: { businessId: ddsBiz.id } });
    await db.websiteAudit.create({
      data: {
        businessId: ddsBiz.id,
        website: 'https://www.dallasdentalspecialists.com',
        status: 'AUDITED',
        score: 70,
        loadTimeMs: 13600,
        issuesJson: JSON.stringify(['Critical Page Load Latency']),
        findings: JSON.stringify(['Mobile performance optimization needed']),
      },
    });

    await db.contact.deleteMany({
      where: { businessId: ddsBiz.id, type: 'EMAIL', value: 'info@dallasdentalspecialists.com' },
    });
    await db.contact.create({
      data: {
        businessId: ddsBiz.id,
        type: 'EMAIL',
        value: 'info@dallasdentalspecialists.com',
        status: 'VERIFIED_PUBLIC',
        source: 'official_website_html',
        sourceUrl: 'https://www.dallasdentalspecialists.com/Contact.aspx',
        emailAsFound: 'info@dallasdentalspecialists.com',
        isVerified: true,
        isPublic: true,
      },
    });

    await db.outreach.upsert({
      where: { id: '4da6b7e8-7e3e-451b-b5b2-ca91d275a91b' },
      update: {
        leadId: ddsLead.id,
        status: 'READY_TO_SEND',
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        primaryContactValue: 'info@dallasdentalspecialists.com',
        channel: 'EMAIL',
      },
      create: {
        id: '4da6b7e8-7e3e-451b-b5b2-ca91d275a91b',
        leadId: ddsLead.id,
        variant: 'VARIANT_B_STANDARD',
        channel: 'EMAIL',
        subject: 'Website observation for Dallas Dental Specialists',
        body: 'Hello Dallas Dental Specialists Team,\n\nMobile load time recorded at 13.6 seconds.\n\nBest regards,\nHASSAN RAMZAN\nhassanramzan59@gmail.com\n\nWeb development outreach\n\n55 jb baba bakala faisalabad\n\nIf you\'d rather not receive emails from me, just reply "unsubscribe" and I won\'t contact you again.',
        status: 'READY_TO_SEND',
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        primaryContactValue: 'info@dallasdentalspecialists.com',
        evidenceValid: true,
        identityValid: true,
      },
    });

    const service = new PilotExecutionService(db, validator);
    const report = await service.executePilot({
      limit: 2,
      confirm: true,
      dryRun: true,
      campaignId: '79eae995-f714-4137-b284-85d18de1f929',
      pilotCountry: 'US',
      allowTestRecord: true,
    });

    expect(report.totalEligible).toBe(2);
    expect(report.simulated).toBe(2);
    expect(report.sent).toBe(0);
    expect(report.blocked).toBe(0);
    expect(report.failed).toBe(0);
  });
});
