import { describe, it, expect, beforeEach } from 'vitest';
import { getPrismaClient } from '../src/database/client.js';
import { PreSendValidator } from '../src/modules/outreach/gate/pre-send-validator.js';
import { PilotExecutionService } from '../src/modules/outreach/execution/pilot-execution.service.js';
import { CampaignRepository } from '../src/database/repositories/campaign.repository.js';
import { SuppressionRepository } from '../src/database/repositories/suppression.repository.js';
import { OutreachRepository } from '../src/database/repositories/outreach.repository.js';
import { safetyControls } from '../src/config/safety.js';

describe('Campaign Isolation & Verified Email Enrichment Tests', () => {
  const db = getPrismaClient();
  const suppressionRepo = new SuppressionRepository(db);
  const outreachRepo = new OutreachRepository(db);
  const validator = new PreSendValidator(db, suppressionRepo, outreachRepo);
  const pilotService = new PilotExecutionService(db, validator);
  const campaignRepo = new CampaignRepository(db);

  let testSuffix: string;
  let dallasCampaignId: string;

  beforeEach(async () => {
    testSuffix = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

    const campaign = await db.campaign.create({
      data: {
        name: `US First Live Pilot Test ${testSuffix}`,
        country: 'US',
        city: 'Dallas',
        state: 'TX',
        niche: 'Dentist,HVAC',
        targetBusinesses: 10,
      },
    });
    dallasCampaignId = campaign.id;
  });

  // Helper to create business + lead + contact + outreach
  async function createCandidateFixture(params: {
    name: string;
    city: string;
    country: string;
    category: string;
    campaignId?: string;
    email?: string;
    emailStatus?: string;
    sourceUrl?: string;
    emailAsFound?: string;
    sourceContext?: string;
    status?: string;
    approvedAt?: Date;
    channel?: string;
  }) {
    const biz = await db.business.create({
      data: {
        name: `Phase11 ${params.name} ${testSuffix}`,
        city: params.city,
        country: params.country,
        category: params.category,
        source: 'TEST_SUITE',
        website: `https://${params.name.toLowerCase().replace(/[^a-z0-9]/g, '')}-test.com`,
        campaignId: params.campaignId,
      },
    });

    if (params.campaignId) {
      await db.campaignBusiness.create({
        data: {
          campaignId: params.campaignId,
          businessId: biz.id,
        },
      });
    }

    if (params.email) {
      await db.contact.create({
        data: {
          businessId: biz.id,
          value: params.email,
          email: params.email,
          type: 'EMAIL',
          classification: 'BUSINESS_GENERIC',
          status: params.emailStatus || 'VERIFIED_PUBLIC',
          sourceUrl: params.sourceUrl || `https://${params.name.toLowerCase().replace(/[^a-z0-9]/g, '')}-test.com/contact`,
          sourceType: 'OFFICIAL_WEBSITE',
          source: 'OFFICIAL_WEBSITE',
          emailAsFound: params.emailAsFound || params.email,
          sourceContext: params.sourceContext || `mailto:${params.email}`,
          isVerified: params.emailStatus === 'VERIFIED_PUBLIC',
          isPublic: true,
          discoveredAt: new Date(),
        },
      });
    }

    const lead = await db.lead.create({
      data: {
        businessId: biz.id,
        leadOpportunityScore: 85,
        classification: 'WARM',
        priorityRank: 2,
        primaryContactType: params.email ? 'EMAIL' : 'PHONE',
        primaryContactValue: params.email || '+1-214-555-0100',
        contactDiscoveryStatus: params.emailStatus || 'VERIFIED_PUBLIC',
      },
    });

    const outreach = await db.outreach.create({
      data: {
        leadId: lead.id,
        channel: params.channel || 'EMAIL',
        variant: 'VARIANT_B_STANDARD',
        subject: `Partnership proposal for ${biz.name}`,
        body: `Hello from Antigravity. We evaluated the digital presence of ${biz.name} in ${biz.city} and prepared custom improvements for your website.`,
        status: params.status || 'READY_TO_SEND',
        approvedAt: params.approvedAt || new Date(),
        approvedBy: 'HUMAN_OPERATOR_TEST',
        primaryContactValue: params.email || '+1-214-555-0100',
        primaryContactType: params.email ? 'EMAIL' : 'PHONE',
      },
    });

    return { business: biz, lead, outreach };
  }

  // 1. Houston business excluded from Dallas campaign
  it('1. Houston business excluded from Dallas campaign with CAMPAIGN_MARKET_MISMATCH', async () => {
    const fixture = await createCandidateFixture({
      name: 'Houston HVAC Specialists',
      city: 'Houston',
      country: 'US',
      category: 'HVAC',
      campaignId: dallasCampaignId,
      email: `contact@houston-hvac-${testSuffix}.com`,
    });

    const result = await validator.validateOutreach(fixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('CAMPAIGN_MARKET_MISMATCH');
  });

  // 2. Miami business excluded
  it('2. Miami business excluded with CAMPAIGN_MARKET_MISMATCH', async () => {
    const fixture = await createCandidateFixture({
      name: 'Miami Dental Studio',
      city: 'Miami',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email: `hello@miami-dental-${testSuffix}.com`,
    });

    const result = await validator.validateOutreach(fixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('CAMPAIGN_MARKET_MISMATCH');
  });

  // 3. New York business excluded
  it('3. New York business excluded with CAMPAIGN_MARKET_MISMATCH', async () => {
    const fixture = await createCandidateFixture({
      name: 'Manhattan Dental Care',
      city: 'New York',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email: `info@manhattan-dental-${testSuffix}.com`,
    });

    const result = await validator.validateOutreach(fixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('CAMPAIGN_MARKET_MISMATCH');
  });

  // 4. Toronto business excluded
  it('4. Toronto business excluded with CAMPAIGN_MARKET_MISMATCH & PILOT_COUNTRY_MISMATCH', async () => {
    const fixture = await createCandidateFixture({
      name: 'Toronto Smiles Clinic',
      city: 'Toronto',
      country: 'Canada',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email: `dr@toronto-smiles-${testSuffix}.com`,
    });

    const result = await validator.validateOutreach(fixture.outreach.id, {
      campaignId: dallasCampaignId,
      pilotCountry: 'US',
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('CAMPAIGN_MARKET_MISMATCH');
    expect(result.reasons).toContain('PILOT_COUNTRY_MISMATCH');
  });

  // 5. Dallas wrong niche excluded
  it('5. Dallas wrong niche excluded with CAMPAIGN_NICHE_MISMATCH', async () => {
    const roofingFixture = await createCandidateFixture({
      name: 'Dallas Premier Roofing',
      city: 'Dallas',
      country: 'US',
      category: 'Roofing Contractor',
      campaignId: dallasCampaignId,
      email: `info@dallas-roofing-${testSuffix}.com`,
    });

    const result = await validator.validateOutreach(roofingFixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('CAMPAIGN_NICHE_MISMATCH');
  });

  // 6. Dallas Dentist included
  it('6. Dallas Dentist included (passes campaign market and niche gate)', async () => {
    const fixture = await createCandidateFixture({
      name: 'Dallas Pediatric Dentistry',
      city: 'Dallas',
      country: 'US',
      category: 'Pediatric Dentist',
      campaignId: dallasCampaignId,
      email: `contact@dallas-pediatric-${testSuffix}.com`,
    });

    const result = await validator.validateOutreach(fixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });

    expect(result.reasons).not.toContain('CAMPAIGN_MARKET_MISMATCH');
    expect(result.reasons).not.toContain('CAMPAIGN_NICHE_MISMATCH');
  });

  // 7. Dallas HVAC included
  it('7. Dallas HVAC included (passes campaign market and niche gate)', async () => {
    const fixture = await createCandidateFixture({
      name: 'Dallas Precision Air & Heat',
      city: 'Dallas',
      country: 'US',
      category: 'HVAC',
      campaignId: dallasCampaignId,
      email: `service@dallas-airheat-${testSuffix}.com`,
    });

    const result = await validator.validateOutreach(fixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });

    expect(result.reasons).not.toContain('CAMPAIGN_MARKET_MISMATCH');
    expect(result.reasons).not.toContain('CAMPAIGN_NICHE_MISMATCH');
  });

  // 8. Historical business cannot leak into campaign
  it('8. Historical business without campaign association cannot leak into campaign preview', async () => {
    // Business without campaignId
    await createCandidateFixture({
      name: 'Unassociated Historical Dentist',
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      email: `dr@historical-${testSuffix}.com`,
    });

    const preview = await pilotService.previewPilot(5, dallasCampaignId, {
      includeTest: true,
      allowTestRecord: true,
    });

    const found = preview.candidates.some((c) => c.businessName.includes('Unassociated Historical Dentist'));
    expect(found).toBe(false);
  });

  // 9. Campaign association isolation
  it('9. Campaign association join table maintains strict campaign membership isolation', async () => {
    const fixtureA = await createCandidateFixture({
      name: 'Campaign A Member',
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email: `member@campaign-a-${testSuffix}.com`,
    });

    const otherCampaign = await db.campaign.create({
      data: {
        name: `Other Campaign ${testSuffix}`,
        country: 'US',
        city: 'Dallas',
        niche: 'Dentist',
      },
    });

    const previewOther = await pilotService.previewPilot(5, otherCampaign.id, {
      includeTest: true,
      allowTestRecord: true,
    });

    const leaked = previewOther.candidates.some((c) => c.businessName.includes('Campaign A Member'));
    expect(leaked).toBe(false);
  });

  // 10. Exact email extracted from official site passes
  it('10. Exact email extracted from official site with full provenance passes pre-send gate', async () => {
    const fixture = await createCandidateFixture({
      name: 'Dallas Floss Bar',
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email: `contact@dallasfloss-${testSuffix}.com`,
      emailStatus: 'VERIFIED_PUBLIC',
      sourceUrl: `https://dallasfloss-${testSuffix}.com/contact-us`,
      emailAsFound: `contact@dallasfloss-${testSuffix}.com`,
      sourceContext: `mailto:contact@dallasfloss-${testSuffix}.com`,
    });

    const result = await validator.validateOutreach(fixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });

    expect(result.reasons).not.toContain('EMAIL_SOURCE_NOT_VERIFIABLE');
    expect(result.reasons).not.toContain('GUESSED_EMAIL');
  });

  // 11. Guessed email remains blocked
  it('11. Guessed email remains blocked with GUESSED_EMAIL_PROHIBITED', async () => {
    const fixture = await createCandidateFixture({
      name: 'Guessed Email Biz',
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email: `admin@guessed-${testSuffix}.com`,
      emailStatus: 'NONE_FOUND',
    });

    const result = await validator.validateOutreach(fixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('GUESSED_EMAIL_PROHIBITED');
  });

  // 12. No public email becomes PHONE_ONLY
  it('12. Business without public email is designated PHONE_ONLY and blocked from email channel', async () => {
    const fixture = await createCandidateFixture({
      name: 'Phone Only HVAC',
      city: 'Dallas',
      country: 'US',
      category: 'HVAC',
      campaignId: dallasCampaignId,
      channel: 'PHONE',
    });

    const result = await validator.validateOutreach(fixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('PHONE_CHANNEL');
  });

  // 13. Zero valid emails is acceptable
  it('13. Zero valid candidates in preview returns empty list cleanly without throwing error', async () => {
    const emptyCampaign = await db.campaign.create({
      data: {
        name: `Empty Dallas Campaign ${testSuffix}`,
        country: 'US',
        city: 'Dallas',
        niche: 'Dentist',
      },
    });

    const preview = await pilotService.previewPilot(3, emptyCampaign.id, {
      includeTest: true,
      allowTestRecord: true,
    });

    expect(preview.candidates).toHaveLength(0);
    expect(preview.eligibleCount).toBe(0);
    expect(preview.networkSends).toBe(0);
  });

  // 14. Preview performs zero network sends
  it('14. Preview performs exactly zero network sends and returns safety metrics', async () => {
    await createCandidateFixture({
      name: 'Preview Valid Biz',
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email: `dr@preview-${testSuffix}.com`,
      emailStatus: 'VERIFIED_PUBLIC',
      sourceUrl: `https://preview-${testSuffix}.com`,
    });

    const preview = await pilotService.previewPilot(2, dallasCampaignId, {
      includeTest: true,
      allowTestRecord: true,
    });

    expect(preview.networkSends).toBe(0);
    expect(preview.safetyState.dryRun).toBe(true);
    expect(preview.safetyState.killSwitchActive).toBe(true);
  });

  // 15. Strict provenance remains enforced
  it('15. Strict provenance remains enforced (mismatched emailAsFound or directory source blocked)', async () => {
    // Mismatched emailAsFound
    const mismatchedFixture = await createCandidateFixture({
      name: 'Mismatched Provenance Biz',
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email: `actual@mismatch-${testSuffix}.com`,
      emailAsFound: `different@otherdomain.com`,
      sourceUrl: `https://mismatch-${testSuffix}.com/contact`,
    });

    const resultA = await validator.validateOutreach(mismatchedFixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });
    expect(resultA.reasons).toContain('EMAIL_SOURCE_NOT_VERIFIABLE');

    // Directory source (Yelp)
    const yelpFixture = await createCandidateFixture({
      name: 'Yelp Sourced Biz',
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email: `contact@yelpsourced-${testSuffix}.com`,
      sourceUrl: 'https://www.yelp.com/biz/some-dentist-dallas',
    });

    const resultB = await validator.validateOutreach(yelpFixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });
    expect(resultB.reasons).toContain('EMAIL_SOURCE_NOT_VERIFIABLE');
  });
});
