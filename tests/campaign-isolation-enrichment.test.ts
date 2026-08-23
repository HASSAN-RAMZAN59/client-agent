import { describe, it, expect, beforeEach } from 'vitest';
import { getPrismaClient } from '../src/database/client.js';
import { PreSendValidator } from '../src/modules/outreach/gate/pre-send-validator.js';
import { PilotExecutionService } from '../src/modules/outreach/execution/pilot-execution.service.js';
import { SuppressionRepository } from '../src/database/repositories/suppression.repository.js';
import { OutreachRepository } from '../src/database/repositories/outreach.repository.js';
import { isStrictlyValidEmail } from '../src/utils/email-validator.js';

describe('Campaign Isolation & Verified Email Enrichment Tests', () => {
  const db = getPrismaClient();
  const suppressionRepo = new SuppressionRepository(db);
  const outreachRepo = new OutreachRepository(db);
  const validator = new PreSendValidator(db, suppressionRepo, outreachRepo);

  let testSuffix: string;
  let dallasCampaignId: string;

  beforeEach(async () => {
    testSuffix = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

    const campaign = await db.campaign.create({
      data: {
        name: `Dallas Pilot Campaign ${testSuffix}`,
        country: 'US',
        city: 'Dallas',
        niche: 'Dentist,HVAC',
        targetBusinesses: 10,
      },
    });
    dallasCampaignId = campaign.id;
  });

  // Helper to create test business with complete chain
  async function createFixture(opts: {
    name: string;
    city: string;
    country: string;
    category: string;
    campaignId?: string | null;
    linkViaJoinTable?: boolean;
    email?: string;
    contactStatus?: string;
    sourceUrl?: string | null;
    emailAsFound?: string;
    channel?: string;
  }) {
    const biz = await db.business.create({
      data: {
        campaignId: opts.campaignId === undefined ? dallasCampaignId : opts.campaignId,
        name: `${opts.name} ${testSuffix}`,
        category: opts.category,
        city: opts.city,
        country: opts.country,
        source: 'test_isolation',
      },
    });

    if (opts.linkViaJoinTable && opts.campaignId) {
      await db.campaignBusiness.create({
        data: {
          campaignId: opts.campaignId,
          businessId: biz.id,
        },
      });
    }

    const email = opts.email || `contact-${testSuffix}@${opts.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
    const contact = await db.contact.create({
      data: {
        businessId: biz.id,
        value: email,
        email,
        type: opts.channel === 'PHONE' ? 'PHONE' : 'EMAIL',
        classification: 'BUSINESS_GENERIC',
        status: opts.contactStatus || 'VERIFIED_PUBLIC',
        sourceUrl: opts.sourceUrl !== undefined ? opts.sourceUrl : `https://${opts.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com/contact`,
        emailAsFound: opts.emailAsFound || email,
        sourceContext: `text: ${email}`,
        isVerified: opts.contactStatus !== 'NONE_FOUND' && opts.contactStatus !== 'INVALID',
        isPublic: true,
      },
    });

    const lead = await db.lead.create({
      data: {
        businessId: biz.id,
        leadOpportunityScore: 85,
        classification: 'HOT',
        primaryContactType: opts.channel === 'PHONE' ? 'PHONE' : 'EMAIL',
        primaryContactValue: email,
        recommendedService: 'WEBSITE_IMPROVEMENT',
      },
    });

    const outreach = await db.outreach.create({
      data: {
        leadId: lead.id,
        channel: opts.channel || 'EMAIL',
        variant: 'VARIANT_A',
        subject: `Improvement for ${opts.name}`,
        body: `Hello ${opts.name},\n\nWe noticed some opportunities.\n\nHASSAN RAMZAN`,
        primaryContactValue: email,
        primaryContactType: opts.channel === 'PHONE' ? 'PHONE' : 'EMAIL',
        status: 'APPROVED',
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: 'HUMAN_OPERATOR',
      },
    });

    return { biz, contact, lead, outreach };
  }

  // 1. Houston business excluded from Dallas campaign
  it('1. Houston business excluded from Dallas campaign', async () => {
    const { outreach } = await createFixture({
      name: 'Houston HVAC Pros',
      city: 'Houston',
      country: 'US',
      category: 'HVAC',
      campaignId: dallasCampaignId,
    });

    const result = await validator.validateOutreach(outreach.id, {
      campaignId: dallasCampaignId,
      campaignCity: 'Dallas',
      campaignCountry: 'US',
      campaignNiche: 'Dentist,HVAC',
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('CAMPAIGN_MARKET_MISMATCH');
  });

  // 2. Miami business excluded
  it('2. Miami business excluded', async () => {
    const { outreach } = await createFixture({
      name: 'Miami Beach Dentist',
      city: 'Miami',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
    });

    const result = await validator.validateOutreach(outreach.id, {
      campaignId: dallasCampaignId,
      campaignCity: 'Dallas',
      campaignCountry: 'US',
      campaignNiche: 'Dentist,HVAC',
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('CAMPAIGN_MARKET_MISMATCH');
  });

  // 3. New York business excluded
  it('3. New York business excluded', async () => {
    const { outreach } = await createFixture({
      name: 'NY Dental Care',
      city: 'New York',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
    });

    const result = await validator.validateOutreach(outreach.id, {
      campaignId: dallasCampaignId,
      campaignCity: 'Dallas',
      campaignCountry: 'US',
      campaignNiche: 'Dentist,HVAC',
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('CAMPAIGN_MARKET_MISMATCH');
  });

  // 4. Toronto business excluded
  it('4. Toronto business excluded', async () => {
    const { outreach } = await createFixture({
      name: 'Toronto Smiles',
      city: 'Toronto',
      country: 'CA',
      category: 'Dentist',
      campaignId: dallasCampaignId,
    });

    const result = await validator.validateOutreach(outreach.id, {
      campaignId: dallasCampaignId,
      campaignCity: 'Dallas',
      campaignCountry: 'US',
      campaignNiche: 'Dentist,HVAC',
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('CAMPAIGN_MARKET_MISMATCH');
  });

  // 5. Dallas wrong niche excluded
  it('5. Dallas wrong niche excluded', async () => {
    const { outreach } = await createFixture({
      name: 'Dallas Legal Firm',
      city: 'Dallas',
      country: 'US',
      category: 'Lawyer',
      campaignId: dallasCampaignId,
    });

    const result = await validator.validateOutreach(outreach.id, {
      campaignId: dallasCampaignId,
      campaignCity: 'Dallas',
      campaignCountry: 'US',
      campaignNiche: 'Dentist,HVAC',
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('CAMPAIGN_NICHE_MISMATCH');
  });

  // 6. Dallas Dentist included
  it('6. Dallas Dentist included', async () => {
    const { outreach } = await createFixture({
      name: 'Dallas Premier Dental',
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
    });

    const result = await validator.validateOutreach(outreach.id, {
      campaignId: dallasCampaignId,
      campaignCity: 'Dallas',
      campaignCountry: 'US',
      campaignNiche: 'Dentist,HVAC',
      allowTestRecord: true,
    });

    expect(result.reasons.filter(r => r.startsWith('CAMPAIGN_'))).toEqual([]);
    expect(result.reasons).not.toContain('CAMPAIGN_MARKET_MISMATCH');
    expect(result.reasons).not.toContain('CAMPAIGN_NICHE_MISMATCH');
  });

  // 7. Dallas HVAC included
  it('7. Dallas HVAC included', async () => {
    const { outreach } = await createFixture({
      name: 'Dallas Air Heating',
      city: 'Dallas',
      country: 'US',
      category: 'HVAC',
      campaignId: dallasCampaignId,
    });

    const result = await validator.validateOutreach(outreach.id, {
      campaignId: dallasCampaignId,
      campaignCity: 'Dallas',
      campaignCountry: 'US',
      campaignNiche: 'Dentist,HVAC',
      allowTestRecord: true,
    });

    expect(result.reasons.filter(r => r.startsWith('CAMPAIGN_'))).toEqual([]);
    expect(result.reasons).not.toContain('CAMPAIGN_MARKET_MISMATCH');
    expect(result.reasons).not.toContain('CAMPAIGN_NICHE_MISMATCH');
  });

  // 8. historical business cannot leak into campaign
  it('8. historical business without campaign link cannot leak into campaign', async () => {
    const { outreach } = await createFixture({
      name: 'Historical Dallas Dental',
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      campaignId: null, // Not associated with campaign
    });

    const result = await validator.validateOutreach(outreach.id, {
      campaignId: dallasCampaignId,
      campaignCity: 'Dallas',
      campaignCountry: 'US',
      campaignNiche: 'Dentist,HVAC',
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('CAMPAIGN_MARKET_MISMATCH');
  });

  // 9. campaign association isolation
  it('9. campaign association isolation via join table or direct foreign key', async () => {
    const otherCampaign = await db.campaign.create({
      data: {
        name: `Other Campaign ${testSuffix}`,
        country: 'US',
        city: 'Houston',
        niche: 'HVAC',
      },
    });

    const { outreach } = await createFixture({
      name: 'Isolated Business',
      city: 'Houston',
      country: 'US',
      category: 'HVAC',
      campaignId: otherCampaign.id,
      linkViaJoinTable: true,
    });

    const executor = new PilotExecutionService(db, validator);
    const preview = await executor.previewPilot(5, dallasCampaignId, {
      pilotCountry: 'US',
      allowTestRecord: true,
      includeTest: true,
    });

    // Must NOT contain outreach from otherCampaign
    const found = preview.candidates.some(c => c.outreachId === outreach.id);
    expect(found).toBe(false);
  });

  // 10. exact email extracted from official site passes
  it('10. exact email extracted from official site passes strict provenance', async () => {
    const email = `verified-${testSuffix}@officialdental.com`;
    const { outreach } = await createFixture({
      name: 'Official Dental Site',
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email,
      contactStatus: 'VERIFIED_PUBLIC',
      sourceUrl: 'https://officialdental.com/contact-us',
      emailAsFound: email,
    });

    const result = await validator.validateOutreach(outreach.id, {
      campaignId: dallasCampaignId,
      campaignCity: 'Dallas',
      campaignCountry: 'US',
      campaignNiche: 'Dentist,HVAC',
      allowTestRecord: true,
    });

    expect(result.reasons).not.toContain('EMAIL_SOURCE_NOT_VERIFIABLE');
    expect(result.reasons).not.toContain('GUESSED_EMAIL');
  });

  // 11. guessed email remains blocked
  it('11. guessed email remains blocked', async () => {
    const email = `info@unverifiedsite.com`;
    const { outreach } = await createFixture({
      name: 'Guessed Dental Biz',
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email,
      contactStatus: 'NONE_FOUND',
      sourceUrl: null,
      emailAsFound: email,
    });

    const result = await validator.validateOutreach(outreach.id, {
      campaignId: dallasCampaignId,
      campaignCity: 'Dallas',
      campaignCountry: 'US',
      campaignNiche: 'Dentist,HVAC',
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('GUESSED_EMAIL');
    expect(result.reasons).toContain('EMAIL_SOURCE_NOT_VERIFIABLE');
  });

  // 12. no public email becomes PHONE_ONLY
  it('12. no public email business becomes PHONE_ONLY and is blocked from email pilot', async () => {
    const { outreach } = await createFixture({
      name: 'Phone Only HVAC',
      city: 'Dallas',
      country: 'US',
      category: 'HVAC',
      campaignId: dallasCampaignId,
      channel: 'PHONE',
      email: '+1 (214) 555-0199',
    });

    const result = await validator.validateOutreach(outreach.id, {
      campaignId: dallasCampaignId,
      campaignCity: 'Dallas',
      campaignCountry: 'US',
      campaignNiche: 'Dentist,HVAC',
      allowTestRecord: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('PHONE_CHANNEL');
  });

  // 13. zero valid emails is acceptable
  it('13. zero valid emails is acceptable and returns empty candidate list gracefully', async () => {
    const emptyCampaign = await db.campaign.create({
      data: {
        name: `Empty Campaign ${testSuffix}`,
        country: 'US',
        city: 'Dallas',
        niche: 'Dentist',
      },
    });

    const executor = new PilotExecutionService(db, validator);
    const preview = await executor.previewPilot(3, emptyCampaign.id, {
      pilotCountry: 'US',
      allowTestRecord: true,
      includeTest: true,
    });

    expect(preview.candidates.length).toBe(0);
    expect(preview.eligibleCount).toBe(0);
    expect(preview.networkSends).toBe(0);
  });

  // 14. preview performs zero network sends
  it('14. preview performs zero network sends', async () => {
    const executor = new PilotExecutionService(db, validator);
    const preview = await executor.previewPilot(2, dallasCampaignId, {
      pilotCountry: 'US',
      allowTestRecord: true,
      includeTest: true,
    });

    expect(preview.networkSends).toBe(0);
  });

  // 15. strict provenance remains enforced
  it('15. strict provenance remains enforced even if contact is marked VERIFIED_PUBLIC without sourceUrl', async () => {
    const email = `nosource-${testSuffix}@nodomain.com`;
    const { outreach } = await createFixture({
      name: 'No Source Dental',
      city: 'Dallas',
      country: 'US',
      category: 'Dentist',
      campaignId: dallasCampaignId,
      email,
      contactStatus: 'VERIFIED_PUBLIC',
      sourceUrl: null, // missing source url
      emailAsFound: email,
    });

    const result = await validator.validateOutreach(outreach.id, {
      campaignId: dallasCampaignId,
      campaignCity: 'Dallas',
      campaignCountry: 'US',
      campaignNiche: 'Dentist,HVAC',
      allowTestRecord: true,
      requireStrictProvenance: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('EMAIL_SOURCE_NOT_VERIFIABLE');
  });
});
