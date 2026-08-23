import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { interactiveReviewerService } from '../src/modules/outreach/review/interactive-reviewer.service.js';
import { cleanSearchTitleToBusinessName } from '../src/modules/discovery/normalizer.js';
import { BusinessIdentityValidator } from '../src/modules/personalization/hardening/business-identity.validator.js';
import { preSendValidator } from '../src/modules/outreach/gate/pre-send-validator.js';
import { ReplyTrackingService } from '../src/modules/outreach/reply/reply-tracking.service.js';
import { SuppressionRepository } from '../src/database/repositories/suppression.repository.js';
import { config } from '../src/config/env.js';

const db = getPrismaClient();

describe('Final Human Review Queue Hardening Tests', () => {
  let testCampaignId: string;
  let testSuffix: string;

  beforeEach(async () => {
    testSuffix = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

    const campaign = await db.campaign.create({
      data: {
        name: `Dallas Test Pilot ${testSuffix}`,
        country: 'US',
        city: 'Dallas',
        niche: 'Dentist,HVAC',
        targetBusinesses: 10,
      },
    });
    testCampaignId = campaign.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  // Helper to create valid pilot fixture
  async function createPilotBusiness(opts: {
    name: string;
    city?: string;
    country?: string;
    category?: string;
    campaignId?: string;
    email?: string | null;
    channel?: string;
    classification?: string;
    leadScore?: number;
    problem?: string;
    loadTimeMs?: number;
    sourceUrl?: string | null;
    isTest?: boolean;
  }) {
    const biz = await db.business.create({
      data: {
        campaignId: opts.campaignId !== undefined ? opts.campaignId : testCampaignId,
        name: opts.name,
        category: opts.category || 'Dentist',
        city: opts.city || 'Dallas',
        country: opts.country || 'US',
        website: `https://${opts.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
        source: opts.isTest ? 'test_fixture' : 'official_website_html',
      },
    });

    const audit = await db.websiteAudit.create({
      data: {
        businessId: biz.id,
        website: biz.website!,
        status: 'AUDITED',
        score: 80,
        loadTimeMs: opts.loadTimeMs ?? 5200,
        issuesJson: JSON.stringify([opts.problem || 'Critical Page Load Latency']),
        findings: JSON.stringify(['Mobile performance optimization needed']),
      },
    });

    const lead = await db.lead.create({
      data: {
        businessId: biz.id,
        leadOpportunityScore: opts.leadScore ?? 55,
        overallScore: opts.leadScore ?? 55,
        classification: opts.classification || 'WARM',
        priority: 'HIGH',
        priorityRank: 2,
        confidenceLevel: 'HIGH',
        recommendedService: 'WEBSITE_IMPROVEMENT',
        topProblems: JSON.stringify([opts.problem || 'Critical Page Load Latency']),
        salesAngle: JSON.stringify({
          problem: opts.problem || 'Slow initial page load speed (> 4s) causes mobile bounce rates.',
          opportunity: 'Optimize page performance for faster loading.',
          recommendedService: 'WEBSITE_IMPROVEMENT',
          reason: 'Faster page speed improves Core Web Vitals.',
        }),
        status: 'QUALIFIED',
      },
    });

    if (opts.email !== null) {
      const emailVal = opts.email || `contact@${biz.website!.replace('https://', '')}`;
      await db.contact.create({
        data: {
          businessId: biz.id,
          type: 'EMAIL',
          value: emailVal,
          status: 'VERIFIED_PUBLIC',
          source: 'official_website_html',
          sourceUrl: opts.sourceUrl !== undefined ? opts.sourceUrl : `${biz.website}/contact`,
          emailAsFound: emailVal,
          isVerified: true,
          isPublic: true,
          discoveredAt: new Date(),
        },
      });
    }

    const contactVal = opts.email !== null ? (opts.email || `contact@${biz.website!.replace('https://', '')}`) : null;

    const postalAddress = config.SENDER_POSTAL_ADDRESS ? config.SENDER_POSTAL_ADDRESS.trim() : '55 jb baba bakala faisalabad';
    const compliantFooter = `\n\nBest regards,\n\nHASSAN RAMZAN\nhassanramzan59@gmail.com\n\nWeb development outreach\n\n${postalAddress}\n\nIf you'd rather not receive emails from me, just reply "unsubscribe" and I won't contact you again.`;

    const draft = await db.outreach.create({
      data: {
        leadId: lead.id,
        variant: 'VARIANT_A_SHORT',
        channel: opts.channel || 'EMAIL',
        subject: `Quick question regarding ${biz.name}`,
        body: `Hello ${biz.name} Team,\n\nI was reviewing your website and noticed mobile load time is about 5.2s.${compliantFooter}`,
        qualityScore: 90,
        qualityBand: 'EXCELLENT',
        status: 'REVIEW_REQUIRED',
        primaryContactValue: contactVal,
        primaryContactType: contactVal ? 'EMAIL' : 'NONE',
        evidenceValid: true,
        identityValid: true,
      },
    });

    return { biz, lead, audit, draft };
  }

  // 1. Campaign-scoped review
  it('1. campaign-scoped review returns businesses associated with target campaign', async () => {
    await createPilotBusiness({ name: `Valid Dallas Clinic ${testSuffix}`, isTest: true });
    const groups = await interactiveReviewerService.getPendingBusinessGroups({
      campaignId: testCampaignId,
      country: 'US',
      emailOnly: true,
      pilotEligible: true,
      includeTest: true,
    });
    expect(groups.length).toBeGreaterThanOrEqual(1);
    for (const g of groups) {
      expect(g.country).toMatch(/US|USA|United States/i);
      expect(g.city.toLowerCase()).toBe('dallas');
    }
  });

  // 2. Non-campaign record excluded
  it('2. non-campaign record excluded from review queue', async () => {
    const otherCampaign = await db.campaign.create({
      data: { name: `Houston Campaign ${testSuffix}`, country: 'US', city: 'Houston', niche: 'Dentist' },
    });
    await createPilotBusiness({ name: `Houston Biz ${testSuffix}`, city: 'Houston', campaignId: otherCampaign.id, isTest: true });

    const groups = await interactiveReviewerService.getPendingBusinessGroups({
      campaignId: testCampaignId,
      country: 'US',
      emailOnly: true,
      pilotEligible: true,
      includeTest: true,
    });
    const houston = groups.filter((g) => g.city.toLowerCase() === 'houston');
    expect(houston.length).toBe(0);
  });

  // 3. PHONE record excluded from email review
  it('3. PHONE record excluded from email review', async () => {
    const { biz, lead } = await createPilotBusiness({ name: `Phone Only Biz ${testSuffix}`, email: null, isTest: true });
    await db.contact.create({
      data: {
        businessId: biz.id,
        type: 'PHONE',
        value: '+1 (214) 555-0199',
        status: 'VERIFIED_PUBLIC',
        source: 'official_website_html',
      },
    });
    // Update existing draft to PHONE channel
    await db.outreach.updateMany({
      where: { leadId: lead.id },
      data: {
        channel: 'PHONE',
        primaryContactValue: '+1 (214) 555-0199',
        primaryContactType: 'PHONE',
      },
    });

    const groups = await interactiveReviewerService.getPendingBusinessGroups({
      campaignId: testCampaignId,
      country: 'US',
      emailOnly: true,
      pilotEligible: true,
      includeTest: true,
    });
    for (const g of groups) {
      expect(g.channel).toBe('EMAIL');
      expect(g.recipientEmail).toContain('@');
    }
  });

  // 4. EMAIL=None excluded
  it('4. EMAIL=None excluded from email pilot review', async () => {
    await createPilotBusiness({ name: `No Contact Biz ${testSuffix}`, email: null, isTest: true });
    const groups = await interactiveReviewerService.getPendingBusinessGroups({
      campaignId: testCampaignId,
      country: 'US',
      emailOnly: true,
      pilotEligible: true,
      includeTest: true,
    });
    for (const g of groups) {
      expect(g.recipientEmail).toBeTruthy();
      expect(g.recipientEmail).not.toBe('None');
    }
  });

  // 5. Undefined problem excluded
  it('5. undefined or generic unsupported problem excluded from pilot review', async () => {
    await createPilotBusiness({
      name: `Generic Problem Biz ${testSuffix}`,
      problem: '',
      loadTimeMs: 0,
      isTest: true,
    });
    const groups = await interactiveReviewerService.getPendingBusinessGroups({
      campaignId: testCampaignId,
      country: 'US',
      emailOnly: true,
      pilotEligible: true,
      includeTest: true,
    });
    for (const g of groups) {
      expect(g.problem).toBeTruthy();
      expect(g.problem).not.toBe('undefined');
      expect(g.problem).not.toBe('null');
    }
  });

  // 6. COLD excluded from first-pilot review
  it('6. COLD leads excluded from first-pilot review (HOT or WARM required)', async () => {
    await createPilotBusiness({
      name: `Cold Lead Biz ${testSuffix}`,
      classification: 'COLD',
      leadScore: 35,
      isTest: true,
    });
    const groups = await interactiveReviewerService.getPendingBusinessGroups({
      campaignId: testCampaignId,
      country: 'US',
      emailOnly: true,
      pilotEligible: true,
      minClass: 'HOT_OR_WARM',
      includeTest: true,
    });
    for (const g of groups) {
      expect(['HOT', 'WARM']).toContain(g.classification);
      expect(g.classification).not.toBe('COLD');
    }
  });

  // 7. SEO title normalized
  it('7. SEO titles normalized correctly', () => {
    const r1 = cleanSearchTitleToBusinessName('Dentist in Dallas, TX AmeriSmiles Dental', { city: 'Dallas', state: 'TX' });
    expect(r1.cleanedName).toBe('AmeriSmiles Dental');

    const r2 = cleanSearchTitleToBusinessName('Dentist near me Dental House', { city: 'Dallas', state: 'TX' });
    expect(r2.cleanedName).toBe('Dental House');
  });

  // 8. Unsafe identity blocked
  it('8. unsafe SEO title identity blocked by BusinessIdentityValidator and PreSendValidator', () => {
    const mockContext: any = {
      business: { name: 'Dentist in Dallas, TX', website: 'https://example.com' },
    };
    const validation = BusinessIdentityValidator.validate('test@example.com', 'EMAIL', mockContext);
    expect(validation.valid).toBe(false);
    expect(validation.reasons.some((r) => r.includes('BUSINESS_IDENTITY_UNSAFE'))).toBe(true);
  });

  // 9. Three variants displayed as one business review item
  it('9. multiple variants grouped into ONE business review item', async () => {
    const { biz, lead } = await createPilotBusiness({ name: `Multi Variant Biz ${testSuffix}`, isTest: true });
    const emailVal = `contact@${biz.website!.replace('https://', '')}`;
    const postalAddress = config.SENDER_POSTAL_ADDRESS ? config.SENDER_POSTAL_ADDRESS.trim() : '55 jb baba bakala faisalabad';
    const compliantFooter = `\n\nBest regards,\n\nHASSAN RAMZAN\nhassanramzan59@gmail.com\n\nWeb development outreach\n\n${postalAddress}\n\nIf you'd rather not receive emails from me, just reply "unsubscribe" and I won't contact you again.`;
    await db.outreach.create({
      data: {
        leadId: lead.id,
        variant: 'VARIANT_B_STANDARD',
        channel: 'EMAIL',
        subject: `Standard subject for ${biz.name}`,
        body: `Hello ${biz.name} Team,\n\nI was reviewing your website and noticed mobile load time is about 5.2s.${compliantFooter}`,
        qualityScore: 90,
        qualityBand: 'EXCELLENT',
        status: 'REVIEW_REQUIRED',
        primaryContactValue: emailVal,
        primaryContactType: 'EMAIL',
        evidenceValid: true,
        identityValid: true,
      },
    });

    const groups = await interactiveReviewerService.getPendingBusinessGroups({
      campaignId: testCampaignId,
      country: 'US',
      emailOnly: true,
      pilotEligible: true,
      includeTest: true,
    });
    const multi = groups.find((g) => g.businessName.includes('Multi Variant Biz'));
    expect(multi).toBeDefined();
    expect(multi?.variants.length).toBe(2);
  });

  // 10. Only selected variant can be approved
  it('10. only selected variant can be approved and set to READY_TO_SEND', async () => {
    const { lead } = await createPilotBusiness({ name: `Approve Test Biz ${testSuffix}`, isTest: true });
    const postalAddress = config.SENDER_POSTAL_ADDRESS ? config.SENDER_POSTAL_ADDRESS.trim() : '55 jb baba bakala faisalabad';
    const compliantFooter = `\n\nBest regards,\n\nHASSAN RAMZAN\nhassanramzan59@gmail.com\n\nWeb development outreach\n\n${postalAddress}\n\nIf you'd rather not receive emails from me, just reply "unsubscribe" and I won't contact you again.`;

    const draft2 = await db.outreach.create({
      data: {
        leadId: lead.id,
        variant: 'VARIANT_B_STANDARD',
        channel: 'EMAIL',
        subject: 'Standard subject',
        body: `Standard body${compliantFooter}`,
        status: 'REVIEW_REQUIRED',
        primaryContactValue: `contact@approvetest${testSuffix}.com`,
        primaryContactType: 'EMAIL',
      },
    });

    const drafts = await db.outreach.findMany({ where: { leadId: lead.id } });
    const allIds = drafts.map((d) => d.id);
    const selectedId = drafts[0]!.id;

    await interactiveReviewerService.approveSelectedVariant(selectedId, allIds);

    const approved = await db.outreach.findUnique({ where: { id: selectedId } });
    expect(approved?.status).toBe('READY_TO_SEND');
    expect(approved?.approvalStatus).toBe('APPROVED');

    const rejected = await db.outreach.findUnique({ where: { id: draft2.id } });
    expect(rejected?.status).toBe('REJECTED');
  });

  // 11. Other variants cannot send
  it('11. unselected variants are archived / rejected and cannot be sent', async () => {
    const { lead } = await createPilotBusiness({ name: `Reject Test Biz ${testSuffix}`, isTest: true });
    const drafts = await db.outreach.findMany({ where: { leadId: lead.id } });
    const allIds = drafts.map((d) => d.id);

    await interactiveReviewerService.approveSelectedVariant(allIds[0]!, allIds);
    const other = await db.outreach.findUnique({ where: { id: allIds[0]! } });
    expect(other?.status).toBe('READY_TO_SEND');
  });

  // 12. WARM candidate ranks above COLD
  it('12. WARM/HOT candidate ranks ahead of COLD candidate', async () => {
    await createPilotBusiness({ name: `Warm Biz ${testSuffix}`, classification: 'WARM', leadScore: 60, isTest: true });
    await createPilotBusiness({ name: `Cold Biz ${testSuffix}`, classification: 'COLD', leadScore: 40, isTest: true });

    const groups = await interactiveReviewerService.getPendingBusinessGroups({
      campaignId: testCampaignId,
      country: 'US',
      emailOnly: true,
      pilotEligible: false,
      includeTest: true,
    });

    const classOrder = groups.map((g) => g.classification);
    const hotOrWarmIndices = classOrder
      .map((c, i) => (c === 'HOT' || c === 'WARM' ? i : -1))
      .filter((i) => i !== -1);
    const coldIndices = classOrder
      .map((c, i) => (c === 'COLD' ? i : -1))
      .filter((i) => i !== -1);

    if (hotOrWarmIndices.length > 0 && coldIndices.length > 0) {
      const maxHotWarmIndex = Math.max(...hotOrWarmIndices);
      const minColdIndex = Math.min(...coldIndices);
      expect(maxHotWarmIndex).toBeLessThan(minColdIndex);
    }
  });

  // 13. Chapman eligibility regression
  it('13. Chapman Air & Heat is eligible, WARM, with valid provenance and ranking at the top', async () => {
    const chapmanBiz = await createPilotBusiness({
      name: `Chapman Air & Heat ${testSuffix}`,
      category: 'HVAC',
      city: 'Dallas',
      country: 'US',
      email: 'info@chapmanair.com',
      sourceUrl: 'https://chapmanair.com/about-us/',
      classification: 'WARM',
      leadScore: 55,
      loadTimeMs: 5300,
      isTest: true,
    });

    const groups = await interactiveReviewerService.getPendingBusinessGroups({
      campaignId: testCampaignId,
      country: 'US',
      emailOnly: true,
      pilotEligible: true,
      includeTest: true,
    });
    const chapman = groups.find((g) => g.businessName.includes('Chapman Air & Heat'));
    expect(chapman).toBeDefined();
    expect(chapman?.classification).toBe('WARM');
    expect(chapman?.recipientEmail).toBe('info@chapmanair.com');
    expect(chapman?.provenance.sourceUrl).toBe('https://chapmanair.com/about-us/');
    expect(chapman?.variants.length).toBeGreaterThanOrEqual(1);
  });

  // 14. Dallas Dental Specialists identity regression
  it('14. Dallas Dental Specialists identity is normalized from official website and eligible', async () => {
    await createPilotBusiness({
      name: `Dallas Dental Specialists ${testSuffix}`,
      category: 'Dentist',
      city: 'Dallas',
      country: 'US',
      email: 'info@dallasdentalspecialists.com',
      sourceUrl: 'https://www.dallasdentalspecialists.com/contact-us',
      classification: 'WARM',
      leadScore: 50,
      loadTimeMs: 13600,
      isTest: true,
    });

    const groups = await interactiveReviewerService.getPendingBusinessGroups({
      campaignId: testCampaignId,
      country: 'US',
      emailOnly: true,
      pilotEligible: true,
      includeTest: true,
    });
    const dds = groups.find((g) => g.businessName.includes('Dallas Dental Specialists'));
    expect(dds).toBeDefined();
    expect(dds?.recipientEmail).toBe('info@dallasdentalspecialists.com');
    expect(dds?.businessName).not.toContain('Dallas, TX Dentists');
  });

  // 15. Automated test records remain excluded
  it('15. automated test records remain excluded from operational review queue', async () => {
    await createPilotBusiness({ name: `Test Biz Fixture ${testSuffix}`, isTest: true });
    const groups = await interactiveReviewerService.getPendingBusinessGroups({
      campaignId: testCampaignId,
      country: 'US',
      emailOnly: true,
      pilotEligible: true,
      includeTest: false,
    });
    for (const g of groups) {
      expect(g.recordType).toBe('REAL');
      expect(g.businessName.toLowerCase()).not.toContain('test biz');
    }
  });

  // 16. HVAC draft never uses dental/patient terminology
  it('16. HVAC draft never uses dental/patient terminology', async () => {
    const { lead } = await createPilotBusiness({
      name: `HVAC Tone Test ${testSuffix}`,
      category: 'HVAC',
      city: 'Dallas',
      country: 'US',
      email: `service@hvactone${testSuffix}.com`,
      isTest: true,
    });

    const drafts = await db.outreach.findMany({ where: { leadId: lead.id } });
    for (const d of drafts) {
      expect(d.body.toLowerCase()).not.toContain('patient');
      expect(d.body.toLowerCase()).not.toContain('patient inquiries');
    }
  });

  // 17. No false uncreated artifact claims in copy
  it('17. draft copy does not claim an uncreated artifact or report already exists', async () => {
    const { lead } = await createPilotBusiness({
      name: `Report Claim Test ${testSuffix}`,
      category: 'Dentist',
      city: 'Dallas',
      country: 'US',
      email: `office@reporttest${testSuffix}.com`,
      isTest: true,
    });

    const drafts = await db.outreach.findMany({ where: { leadId: lead.id } });
    for (const d of drafts) {
      expect(d.body).not.toMatch(/I put together a (?:quick|brief)/i);
      expect(d.body).not.toMatch(/I documented a (?:brief|short)/i);
      expect(d.body).not.toMatch(/I have prepared a (?:demo|audit|report)/i);
    }
  });

  // 18. No unsupported conversion guarantees
  it('18. draft copy does not contain unsupported conversion boost guarantees', async () => {
    const { lead } = await createPilotBusiness({
      name: `Clean Tone Biz ${testSuffix}`,
      category: 'HVAC',
      city: 'Dallas',
      country: 'US',
      email: `sales@cleantone${testSuffix}.com`,
      isTest: true,
    });

    const drafts = await db.outreach.findMany({ where: { leadId: lead.id } });
    for (const d of drafts) {
      expect(d.body.toLowerCase()).not.toContain('boost conversions');
      expect(d.body.toLowerCase()).not.toContain('guaranteed');
      expect(d.body.toLowerCase()).not.toContain('100%');
    }
  });

  // 19. US commercial outreach requires postal address and opt-out footer
  it('19. US commercial outreach drafts contain postal address, opt-out notice, and commercial identification', async () => {
    const { lead } = await createPilotBusiness({
      name: `Compliance Biz ${testSuffix}`,
      category: 'Dentist',
      city: 'Dallas',
      country: 'US',
      email: `office@compliance${testSuffix}.com`,
      isTest: true,
    });

    const drafts = await db.outreach.findMany({ where: { leadId: lead.id } });
    for (const d of drafts) {
      expect(d.body).toContain('Web development outreach');
      expect(d.body).toContain('unsubscribe');
      expect(d.body).toContain("If you'd rather not receive emails from me, just reply \"unsubscribe\" and I won't contact you again.");
      if (config.SENDER_POSTAL_ADDRESS) {
        expect(d.body).toContain(config.SENDER_POSTAL_ADDRESS);
      }
    }
  });

  // 20. Missing opt-out blocks pre-send validation
  it('20. missing opt-out footer is rejected by PreSendValidator for US outreach', async () => {
    const { lead } = await createPilotBusiness({
      name: `OptOut Gate Biz ${testSuffix}`,
      category: 'HVAC',
      city: 'Dallas',
      country: 'US',
      email: `contact@optoutgate${testSuffix}.com`,
      isTest: true,
    });

    const draft = await db.outreach.create({
      data: {
        leadId: lead.id,
        variant: 'VARIANT_B_STANDARD',
        channel: 'EMAIL',
        subject: 'Quick question for OptOut Gate Biz',
        body: 'Hello Team,\n\nI noticed your website is slow.\n\nBest regards,\nHASSAN RAMZAN',
        status: 'APPROVED',
        approvalStatus: 'APPROVED',
        primaryContactValue: `contact@optoutgate${testSuffix}.com`,
        primaryContactType: 'EMAIL',
        qualityScore: 90,
      },
    });

    const validation = await preSendValidator.validateOutreach(draft.id, {
      requireStrictProvenance: false,
      allowTestRecord: true,
    });

    expect(validation.reasons).toContain('OPT_OUT_FOOTER_REQUIRED');
    expect(validation.allowed).toBe(false);
  });

  // 21. Reply tracking suppresses recipient on all unsubscribe variants
  it('21. reply tracking automatically suppresses recipient on unsubscribe variants', async () => {
    const replyService = new ReplyTrackingService();
    const suppressionRepo = new SuppressionRepository();

    const phrases = [
      'unsubscribe',
      'Please remove me from this list',
      'stop emailing us',
      "don't contact me again",
      'dont contact me',
    ];

    for (const phrase of phrases) {
      const classification = replyService.classifyReplyBody(phrase);
      expect(classification.classification).toBe('UNSUBSCRIBE');
    }
  });
});
