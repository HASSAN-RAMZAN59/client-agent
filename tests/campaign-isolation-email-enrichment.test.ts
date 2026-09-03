import { describe, it, expect, beforeEach } from 'vitest';
import { getPrismaClient } from '../src/database/client.js';
import { PreSendValidator } from '../src/modules/outreach/gate/pre-send-validator.js';
import { PilotExecutionService } from '../src/modules/outreach/execution/pilot-execution.service.js';
import { CampaignRepository } from '../src/database/repositories/campaign.repository.js';
import { SuppressionRepository } from '../src/database/repositories/suppression.repository.js';
import { OutreachRepository } from '../src/database/repositories/outreach.repository.js';
import { safetyControls } from '../src/config/safety.js';
import { isStrictlyValidEmail } from '../src/utils/email-validator.js';

describe('Campaign Isolation & Verified Email Enrichment Tests (20 Acceptance Scenarios)', () => {
  const db = getPrismaClient();
  const suppressionRepo = new SuppressionRepository(db);
  const outreachRepo = new OutreachRepository(db);
  const validator = new PreSendValidator(db, suppressionRepo, outreachRepo);
  const pilotService = new PilotExecutionService(db, validator);
  const campaignRepo = new CampaignRepository(db);

  let testSuffix: string;
  let cleanSuffix: string;
  let dallasCampaignId: string;

  beforeEach(async () => {
    testSuffix = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    cleanSuffix = testSuffix.replace(/[^a-zA-Z0-9]/g, '');

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

  // Helper to create business + audit + lead + contact + outreach
  async function createCandidateFixture(params: {
    name: string;
    rawName?: string;
    city: string;
    country: string;
    category: string;
    campaignId?: string;
    email?: string;
    emailStatus?: string;
    sourceUrl?: string;
    emailAsFound?: string;
    sourceContext?: string;
    sourceType?: string;
    source?: string;
    status?: string;
    approvedAt?: Date;
    channel?: string;
    body?: string;
    auditStatus?: string;
    loadTimeMs?: number;
    issuesJson?: string;
  }) {
    const bizName = params.rawName || `Phase11 ${params.name} ${testSuffix}`;
    const biz = await db.business.create({
      data: {
        name: bizName,
        city: params.city,
        country: params.country,
        category: params.category,
        source: params.source || 'TEST_SUITE',
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

    // Default audit with measured concrete issues unless overridden
    await db.websiteAudit.create({
      data: {
        businessId: biz.id,
        website: biz.website || 'https://example.com',
        status: params.auditStatus || 'AUDITED',
        score: 80,
        loadTimeMs: params.loadTimeMs !== undefined ? params.loadTimeMs : 3200,
        issuesJson: params.issuesJson !== undefined ? params.issuesJson : JSON.stringify(['Critical Page Load Latency']),
        mobileResponsive: true,
      },
    });

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
          sourceType: params.sourceType || 'OFFICIAL_WEBSITE',
          source: params.source || 'OFFICIAL_WEBSITE',
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

    const defaultBody = `Hello from Antigravity. We evaluated the digital presence of ${biz.name} in ${biz.city} and noted initial mobile page load time was 3.2s. Reply "unsubscribe" to opt out.\n55 jb baba bakala faisalabad\nWeb development outreach`;

    const outreach = await db.outreach.create({
      data: {
        leadId: lead.id,
        channel: params.channel || 'EMAIL',
        variant: 'VARIANT_B_STANDARD',
        subject: `Partnership proposal for ${biz.name}`,
        body: params.body !== undefined ? params.body : defaultBody,
        status: params.status || 'READY_TO_SEND',
        approvedAt: params.approvedAt || new Date(),
        approvedBy: 'HUMAN_OPERATOR_TEST',
        primaryContactValue: params.email || '+1-214-555-0100',
        primaryContactType: params.email ? 'EMAIL' : 'PHONE',
      },
    });

    return { business: biz, lead, outreach };
  }

  // 1. Houston excluded from Dallas campaign
  it('1. Houston excluded from Dallas campaign with CAMPAIGN_MARKET_MISMATCH', async () => {
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

  // 2. Miami excluded
  it('2. Miami excluded with CAMPAIGN_MARKET_MISMATCH', async () => {
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

  // 3. New York excluded
  it('3. New York excluded with CAMPAIGN_MARKET_MISMATCH', async () => {
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

  // 4. Toronto excluded
  it('4. Toronto excluded with CAMPAIGN_MARKET_MISMATCH & PILOT_COUNTRY_MISMATCH', async () => {
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

  // 8. Campaign relationship isolation
  it('8. Campaign relationship isolation (join table enforces strict membership)', async () => {
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

  // 9. Historical record cannot leak into pilot
  it('9. Historical record cannot leak into pilot without campaign association', async () => {
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

  // 10. Valid official-source email accepted
  it('10. Valid official-source email accepted with complete provenance', async () => {
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

  // 11. Guessed email rejected
  it('11. Guessed email rejected with GUESSED_EMAIL_PROHIBITED', async () => {
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

  // 12. Source URL without matching email rejected
  it('12. Source URL without matching email rejected with EMAIL_SOURCE_NOT_VERIFIABLE', async () => {
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

    const result = await validator.validateOutreach(mismatchedFixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('EMAIL_SOURCE_NOT_VERIFIABLE');
  });

  // 13. OSM email without complete provenance blocked
  it('13. OSM email without complete provenance blocked with EMAIL_SOURCE_NOT_VERIFIABLE', async () => {
    const osmFixture = await createCandidateFixture({
      name: 'OSM Sourced Dental',
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email: `info@osmdental-${testSuffix}.com`,
      source: 'osm_overpass',
      sourceType: 'PUBLIC_LISTING',
      sourceUrl: 'https://www.openstreetmap.org/node/1234567',
    });

    const result = await validator.validateOutreach(osmFixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('EMAIL_SOURCE_NOT_VERIFIABLE');
  });

  // 14. Invalid token rejected
  it('14. Invalid token rejected (UUIDs, hex strings, telemetry tokens, missing @)', async () => {
    // 14a. Telemetry token rejected by email validator
    const sentryToken = '605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com';
    const sentryCheck = isStrictlyValidEmail(sentryToken);
    expect(sentryCheck.valid).toBe(false);

    // 14b. UUID token rejected
    const uuidToken = '123e4567-e89b-12d3-a456-426614174000';
    const uuidCheck = isStrictlyValidEmail(uuidToken);
    expect(uuidCheck.valid).toBe(false);

    // 14c. Rejection in pre-send validator
    const invalidTokenFixture = await createCandidateFixture({
      name: 'Invalid Token Dental',
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email: sentryToken,
    });

    const result = await validator.validateOutreach(invalidTokenFixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('INVALID_EMAIL_CONTACT');
  });

  // 15. Wrong branch email rejected
  it('15. Wrong branch email rejected with LOCATION_CONTACT_MISMATCH', async () => {
    const branchFixture = await createCandidateFixture({
      name: 'Multi Location Dental Dallas',
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email: `houston@multidental-${testSuffix}.com`,
      sourceUrl: `https://multidental-${testSuffix}.com/locations-houston`,
    });

    const result = await validator.validateOutreach(branchFixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('LOCATION_CONTACT_MISMATCH');
  });

  // 16. Phone-only lead retained
  it('16. Phone-only lead retained without inventing email address', async () => {
    const phoneFixture = await createCandidateFixture({
      name: 'Phone Only HVAC Pro',
      city: 'Dallas',
      country: 'US',
      category: 'HVAC',
      campaignId: dallasCampaignId,
      channel: 'PHONE',
    });

    const result = await validator.validateOutreach(phoneFixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('PHONE_CHANNEL');
  });

  // 17. Unsafe business identity rejected
  it('17. Unsafe business identity rejected with BUSINESS_IDENTITY_UNSAFE', async () => {
    const unsafeBizFixture = await createCandidateFixture({
      name: 'Unsafe Dental',
      rawName: `Dentist in Dallas, TX AmeriSmiles Dental ${testSuffix}`,
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email: 'contact@unsafename.com',
    });

    const result = await validator.validateOutreach(unsafeBizFixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('BUSINESS_IDENTITY_UNSAFE');
  });

  // 18. Undefined audit problem rejected
  it('18. Undefined audit problem rejected with UNDEFINED_AUDIT_PROBLEM', async () => {
    const undefinedAuditFixture = await createCandidateFixture({
      name: 'Undefined Audit Dental',
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email: `contact@undefinedaudit-${testSuffix}.com`,
      body: `Hello Team, Problem Detected = undefined for your website. Unsubscribe to opt out.\n55 jb baba bakala faisalabad\nWeb development outreach`,
      loadTimeMs: 0,
      issuesJson: '[]',
    });

    const result = await validator.validateOutreach(undefinedAuditFixture.outreach.id, {
      campaignId: dallasCampaignId,
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('UNDEFINED_AUDIT_PROBLEM');
  });

  // 19. Zero valid email candidates is acceptable
  it('19. Zero valid email candidates is acceptable and returns empty list cleanly', async () => {
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

  // 20. Preview sends zero network messages
  it('20. Preview sends zero network messages and preserves safety invariants', async () => {
    await createCandidateFixture({
      name: 'Preview Valid Dental',
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
    expect(preview.safetyState.outreachEnabled).toBe(false);
    expect(preview.safetyState.livePilotEnabled).toBe(false);
  });
});
