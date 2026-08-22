import { describe, it, expect, beforeEach } from 'vitest';
import { getPrismaClient } from '../src/database/client.js';
import { PreSendValidator } from '../src/modules/outreach/gate/pre-send-validator.js';
import { PilotExecutionService } from '../src/modules/outreach/execution/pilot-execution.service.js';
import { SuppressionRepository } from '../src/database/repositories/suppression.repository.js';
import { OutreachRepository } from '../src/database/repositories/outreach.repository.js';
import { isStrictlyValidEmail, normalizeCountryCode } from '../src/utils/email-validator.js';

describe('Pilot Candidate Selection Hardening', () => {
  const db = getPrismaClient();
  const suppressionRepo = new SuppressionRepository(db);
  const outreachRepo = new OutreachRepository(db);
  const validator = new PreSendValidator(db, suppressionRepo, outreachRepo);

  let testSuffix: string;
  let testCampaignId: string;

  beforeEach(async () => {
    testSuffix = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

    const campaign = await db.campaign.create({
      data: {
        name: `Hardening Test Campaign ${testSuffix}`,
        country: 'US',
        city: 'Dallas',
        niche: 'Dentist',
        targetBusinesses: 10,
      },
    });
    testCampaignId = campaign.id;
  });

  // ===== EMAIL VALIDATION UNIT TESTS =====

  describe('1. Strict Email Validation', () => {
    it('1. UUID-like contact value should be rejected with INVALID reason', () => {
      const result = isStrictlyValidEmail('87b2c8764a084cdbb5281715ec');
      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('2. Contact value missing @ should be rejected', () => {
      const result = isStrictlyValidEmail('nodomain.com');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('MISSING_AT_SIGN');
    });

    it('3. Contact with invalid domain should be rejected', () => {
      const result = isStrictlyValidEmail('user@domain');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('MISSING_TLD');
    });

    it('4. Valid email address should be accepted', () => {
      const result = isStrictlyValidEmail('admin@sohodental.com');
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('5. Hex string that looks like a database ID should be rejected', () => {
      const result = isStrictlyValidEmail('a1b2c3d4e5f6a7b8c9d0e1f2a3b4');
      expect(result.valid).toBe(false);
    });

    it('6. Empty/null/undefined values should be rejected', () => {
      expect(isStrictlyValidEmail(null).valid).toBe(false);
      expect(isStrictlyValidEmail(undefined).valid).toBe(false);
      expect(isStrictlyValidEmail('').valid).toBe(false);
    });

    it('7. Numeric-only value should be rejected', () => {
      const result = isStrictlyValidEmail('123456');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('NUMERIC_ONLY');
    });
  });

  // ===== COUNTRY NORMALIZATION =====

  describe('2. Country Normalization', () => {
    it('8. US variants should normalize to US', () => {
      expect(normalizeCountryCode('US')).toBe('US');
      expect(normalizeCountryCode('USA')).toBe('US');
      expect(normalizeCountryCode('United States')).toBe('US');
    });

    it('9. Canadian variants should normalize to CA', () => {
      expect(normalizeCountryCode('CA')).toBe('CA');
      expect(normalizeCountryCode('Canada')).toBe('CA');
    });
  });

  // ===== PRE-SEND VALIDATOR: COUNTRY GATE =====

  describe('3. Pilot Country Gate (US-only)', () => {
    it('10. Non-US lead should receive PILOT_COUNTRY_MISMATCH when pilotCountry=US', async () => {
      const biz = await db.business.create({
        data: {
          campaignId: testCampaignId,
          name: `Canadian Dental ${testSuffix}`,
          category: 'Dentist',
          city: 'Toronto',
          country: 'CA',
          source: 'test_hardening',
        },
      });

      const email = `admin-ca-${testSuffix}@example-dental.ca`;
      await db.contact.create({
        data: {
          businessId: biz.id,
          value: email,
          email,
          type: 'EMAIL',
          classification: 'BUSINESS_GENERIC',
          status: 'VERIFIED_PUBLIC',
        },
      });

      const lead = await db.lead.create({
        data: {
          businessId: biz.id,
          leadOpportunityScore: 85,
          classification: 'HOT',
          primaryContactType: 'EMAIL',
          primaryContactValue: email,
          recommendedService: 'WEBSITE_IMPROVEMENT',
        },
      });

      const outreach = await db.outreach.create({
        data: {
          leadId: lead.id,
          channel: 'EMAIL',
          variant: 'VARIANT_A',
          subject: `Website for Canadian Dental ${testSuffix}`,
          body: `Hello Canadian Dental ${testSuffix} in Toronto,\n\nWe noticed some improvements.\n\nHASSAN RAMZAN`,
          primaryContactValue: email,
          primaryContactType: 'EMAIL',
          status: 'APPROVED',
          approvalStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: 'HUMAN_OPERATOR',
        },
      });

      const result = await validator.isLivePilotEligible(outreach.id, { pilotCountry: 'US' });
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('PILOT_COUNTRY_MISMATCH');
    });

    it('11. US lead should NOT get PILOT_COUNTRY_MISMATCH when pilotCountry=US', async () => {
      const biz = await db.business.create({
        data: {
          campaignId: testCampaignId,
          name: `Dallas HVAC ${testSuffix}`,
          category: 'HVAC',
          city: 'Dallas',
          country: 'US',
          source: 'test_hardening',
        },
      });

      const email = `info-us-${testSuffix}@dallashvac.com`;
      await db.contact.create({
        data: {
          businessId: biz.id,
          value: email,
          email,
          type: 'EMAIL',
          classification: 'BUSINESS_GENERIC',
          status: 'VERIFIED_PUBLIC',
          sourceUrl: 'https://dallashvac.com/contact',
        },
      });

      const lead = await db.lead.create({
        data: {
          businessId: biz.id,
          leadOpportunityScore: 90,
          classification: 'HOT',
          primaryContactType: 'EMAIL',
          primaryContactValue: email,
          recommendedService: 'WEBSITE_IMPROVEMENT',
        },
      });

      const outreach = await db.outreach.create({
        data: {
          leadId: lead.id,
          channel: 'EMAIL',
          variant: 'VARIANT_A',
          subject: `Website for Dallas HVAC ${testSuffix}`,
          body: `Hello Dallas HVAC ${testSuffix} in Dallas,\n\nWe noticed some improvements.\n\nHASSAN RAMZAN`,
          primaryContactValue: email,
          primaryContactType: 'EMAIL',
          status: 'APPROVED',
          approvalStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: 'HUMAN_OPERATOR',
        },
      });

      const result = await validator.isLivePilotEligible(outreach.id, { pilotCountry: 'US', allowTestRecord: true });
      expect(result.reasons).not.toContain('PILOT_COUNTRY_MISMATCH');
    });
  });

  // ===== PRE-SEND VALIDATOR: INVALID EMAIL CONTACT =====

  describe('4. Invalid Email Contact Gate', () => {
    it('12. Hex token as contact value should produce INVALID_EMAIL_CONTACT', async () => {
      const biz = await db.business.create({
        data: {
          campaignId: testCampaignId,
          name: `Hex Contact HVAC ${testSuffix}`,
          category: 'HVAC',
          city: 'Dallas',
          country: 'US',
          source: 'test_hardening',
        },
      });

      const hexContact = '87b2c8764a084cdbb5281715ec';
      const lead = await db.lead.create({
        data: {
          businessId: biz.id,
          leadOpportunityScore: 70,
          classification: 'WARM',
          primaryContactType: 'EMAIL',
          primaryContactValue: hexContact,
          recommendedService: 'WEBSITE_IMPROVEMENT',
        },
      });

      const outreach = await db.outreach.create({
        data: {
          leadId: lead.id,
          channel: 'EMAIL',
          variant: 'VARIANT_A',
          subject: `Website for Hex Contact HVAC ${testSuffix}`,
          body: `Hello Hex Contact HVAC ${testSuffix} in Dallas,\n\nWe noticed some improvements.\n\nHASSAN RAMZAN`,
          primaryContactValue: hexContact,
          primaryContactType: 'EMAIL',
          status: 'APPROVED',
          approvalStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: 'HUMAN_OPERATOR',
        },
      });

      const result = await validator.isLivePilotEligible(outreach.id, { allowTestRecord: true });
      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('INVALID_EMAIL_CONTACT');
    });
  });

  // ===== PILOT PREVIEW: COUNTRY + EMAIL FILTERING =====

  // ===== STRICT EMAIL PROVENANCE TESTS =====

  describe('5. Strict Email Provenance Validation', () => {
    it('13. VERIFIED_PUBLIC without sourceUrl must be BLOCKED with EMAIL_SOURCE_NOT_VERIFIABLE', async () => {
      const biz = await db.business.create({
        data: {
          campaignId: testCampaignId,
          name: `No Source Dental ${testSuffix}`,
          category: 'Dentist',
          city: 'Dallas',
          country: 'US',
          source: 'test_hardening',
        },
      });

      const email = `contact-${testSuffix}@nosourcedental.com`;
      await db.contact.create({
        data: {
          businessId: biz.id,
          value: email,
          email,
          type: 'EMAIL',
          classification: 'BUSINESS_GENERIC',
          status: 'VERIFIED_PUBLIC',
          isVerified: true,
          sourceUrl: null, // No source URL
        },
      });

      const lead = await db.lead.create({
        data: {
          businessId: biz.id,
          leadOpportunityScore: 85,
          classification: 'HOT',
          primaryContactType: 'EMAIL',
          primaryContactValue: email,
          recommendedService: 'WEBSITE_IMPROVEMENT',
        },
      });

      const outreach = await db.outreach.create({
        data: {
          leadId: lead.id,
          channel: 'EMAIL',
          variant: 'VARIANT_A',
          subject: `Website for No Source Dental ${testSuffix}`,
          body: `Hello No Source Dental ${testSuffix} in Dallas,\n\nWe noticed some improvements.\n\nHASSAN RAMZAN`,
          primaryContactValue: email,
          primaryContactType: 'EMAIL',
          status: 'APPROVED',
          approvalStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: 'HUMAN_OPERATOR',
        },
      });

      const result = await validator.isLivePilotEligible(outreach.id, {
        allowTestRecord: true,
        pilotCountry: 'US',
        requireStrictProvenance: true,
      });

      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('EMAIL_SOURCE_NOT_VERIFIABLE');
    });

    it('14. Contact with exact official-source URL must PASS provenance check', async () => {
      const biz = await db.business.create({
        data: {
          campaignId: testCampaignId,
          name: `Proven Dental ${testSuffix}`,
          category: 'Dentist',
          city: 'Dallas',
          country: 'US',
          website: 'https://provendental.com',
          source: 'test_hardening',
        },
      });

      const email = `appointments-${testSuffix}@provendental.com`;
      await db.contact.create({
        data: {
          businessId: biz.id,
          value: email,
          email,
          type: 'EMAIL',
          classification: 'BUSINESS_GENERIC',
          status: 'VERIFIED_PUBLIC',
          isVerified: true,
          isPublic: true,
          sourceUrl: 'https://provendental.com/contact',
          source: 'OFFICIAL_WEBSITE',
          discoveredAt: new Date(),
        },
      });

      const lead = await db.lead.create({
        data: {
          businessId: biz.id,
          leadOpportunityScore: 92,
          classification: 'HOT',
          primaryContactType: 'EMAIL',
          primaryContactValue: email,
          recommendedService: 'WEBSITE_IMPROVEMENT',
        },
      });

      const outreach = await db.outreach.create({
        data: {
          leadId: lead.id,
          channel: 'EMAIL',
          variant: 'VARIANT_A',
          subject: `Website for Proven Dental ${testSuffix}`,
          body: `Hello Proven Dental ${testSuffix} in Dallas,\n\nWe noticed some improvements.\n\nHASSAN RAMZAN`,
          primaryContactValue: email,
          primaryContactType: 'EMAIL',
          status: 'APPROVED',
          approvalStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: 'HUMAN_OPERATOR',
        },
      });

      const result = await validator.isLivePilotEligible(outreach.id, {
        allowTestRecord: true,
        pilotCountry: 'US',
        requireStrictProvenance: true,
      });

      expect(result.reasons).not.toContain('EMAIL_SOURCE_NOT_VERIFIABLE');
      expect(result.reasons).not.toContain('PILOT_COUNTRY_MISMATCH');
    });

    it('15. OSM contact without source URL remains stored in DB but is blocked from live pilot', async () => {
      const biz = await db.business.create({
        data: {
          campaignId: testCampaignId,
          name: `OSM Tagged Biz ${testSuffix}`,
          category: 'HVAC',
          city: 'Dallas',
          country: 'US',
          source: 'osm_overpass',
        },
      });

      const email = `osmtag-${testSuffix}@osmbiz.com`;
      const contact = await db.contact.create({
        data: {
          businessId: biz.id,
          value: email,
          email,
          type: 'EMAIL',
          classification: 'BUSINESS_GENERIC',
          status: 'VERIFIED_PUBLIC',
          source: 'osm_tag',
          sourceUrl: null, // OSM tag has email but no verifiable source URL
        },
      });

      // Assert contact is stored in DB
      const storedContact = await db.contact.findUnique({ where: { id: contact.id } });
      expect(storedContact).toBeDefined();
      expect(storedContact?.value).toBe(email);

      const lead = await db.lead.create({
        data: {
          businessId: biz.id,
          leadOpportunityScore: 80,
          classification: 'WARM',
          primaryContactType: 'EMAIL',
          primaryContactValue: email,
          recommendedService: 'WEBSITE_IMPROVEMENT',
        },
      });

      const outreach = await db.outreach.create({
        data: {
          leadId: lead.id,
          channel: 'EMAIL',
          variant: 'VARIANT_A',
          subject: `Website for OSM Tagged Biz ${testSuffix}`,
          body: `Hello OSM Tagged Biz ${testSuffix} in Dallas,\n\nWe noticed some improvements.\n\nHASSAN RAMZAN`,
          primaryContactValue: email,
          primaryContactType: 'EMAIL',
          status: 'APPROVED',
          approvalStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: 'HUMAN_OPERATOR',
        },
      });

      const result = await validator.isLivePilotEligible(outreach.id, {
        allowTestRecord: true,
        pilotCountry: 'US',
        requireStrictProvenance: true,
      });

      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('EMAIL_SOURCE_NOT_VERIFIABLE');
    });
  });

  // ===== PILOT PREVIEW: COUNTRY + EMAIL + PROVENANCE FILTERING =====

  describe('6. Pilot Preview Filtering & Safety', () => {
    it('16. previewPilot with pilotCountry=US should exclude Canadian leads', async () => {
      const caBiz = await db.business.create({
        data: {
          campaignId: testCampaignId,
          name: `Preview CA Dental ${testSuffix}`,
          category: 'Dentist',
          city: 'Toronto',
          country: 'CA',
          source: 'test_hardening',
        },
      });

      const caEmail = `preview-ca-${testSuffix}@cadental.com`;
      await db.contact.create({
        data: {
          businessId: caBiz.id,
          value: caEmail,
          email: caEmail,
          type: 'EMAIL',
          classification: 'BUSINESS_GENERIC',
          status: 'VERIFIED_PUBLIC',
          sourceUrl: 'https://cadental.com/contact',
        },
      });

      const caLead = await db.lead.create({
        data: {
          businessId: caBiz.id,
          leadOpportunityScore: 92,
          classification: 'HOT',
          primaryContactType: 'EMAIL',
          primaryContactValue: caEmail,
          recommendedService: 'WEBSITE_IMPROVEMENT',
        },
      });

      await db.outreach.create({
        data: {
          leadId: caLead.id,
          channel: 'EMAIL',
          variant: 'VARIANT_A',
          subject: `Website for Preview CA Dental ${testSuffix}`,
          body: `Hello Preview CA Dental ${testSuffix},\n\nImprovements.\n\nHASSAN RAMZAN`,
          primaryContactValue: caEmail,
          primaryContactType: 'EMAIL',
          status: 'APPROVED',
          approvalStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: 'HUMAN_OPERATOR',
        },
      });

      const executor = new PilotExecutionService(db, validator);
      const preview = await executor.previewPilot(3, testCampaignId, {
        pilotCountry: 'US',
        allowTestRecord: true,
        includeTest: true,
      });

      const caCandidate = preview.candidates.find((c) => c.businessName.includes('Preview CA Dental'));
      expect(caCandidate).toBeUndefined();
    });

    it('17. previewPilot should skip invalid email contacts and increment invalidEmailRejected', async () => {
      const biz = await db.business.create({
        data: {
          campaignId: testCampaignId,
          name: `Invalid Email Biz ${testSuffix}`,
          category: 'HVAC',
          city: 'Dallas',
          country: 'US',
          source: 'test_hardening',
        },
      });

      const badEmail = 'abc123def456';
      const lead = await db.lead.create({
        data: {
          businessId: biz.id,
          leadOpportunityScore: 95,
          classification: 'HOT',
          primaryContactType: 'EMAIL',
          primaryContactValue: badEmail,
          recommendedService: 'WEBSITE_IMPROVEMENT',
        },
      });

      await db.outreach.create({
        data: {
          leadId: lead.id,
          channel: 'EMAIL',
          variant: 'VARIANT_A',
          subject: `Website for Invalid Email Biz ${testSuffix}`,
          body: `Hello Invalid Email Biz ${testSuffix},\n\nImprovements.\n\nHASSAN RAMZAN`,
          primaryContactValue: badEmail,
          primaryContactType: 'EMAIL',
          status: 'APPROVED',
          approvalStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: 'HUMAN_OPERATOR',
        },
      });

      const executor = new PilotExecutionService(db, validator);
      const preview = await executor.previewPilot(3, testCampaignId, {
        allowTestRecord: true,
        includeTest: true,
      });

      const badCandidate = preview.candidates.find((c) => c.recipientEmail === badEmail);
      expect(badCandidate).toBeUndefined();
      expect(preview.invalidEmailRejected).toBeGreaterThanOrEqual(1);
    });

    it('18. previewPilot should produce zero network sends and report candidateQuality + liveSendState', async () => {
      const executor = new PilotExecutionService(db, validator);
      const preview = await executor.previewPilot(3, testCampaignId, {
        pilotCountry: 'US',
        allowTestRecord: true,
        includeTest: true,
      });

      expect(preview.networkSends).toBe(0);
      expect(typeof preview.invalidEmailRejected).toBe('number');
      expect(typeof preview.nonUSRejected).toBe('number');
      expect(typeof preview.provenanceWarnings).toBe('number');

      for (const c of preview.candidates) {
        expect(['VALID', 'INVALID']).toContain(c.candidateQuality);
        expect(['BLOCKED', 'ENABLED']).toContain(c.liveSendState);
      }
    });

    it('19. candidate with missing provenance shows candidateQuality=INVALID in preview', async () => {
      const biz = await db.business.create({
        data: {
          campaignId: testCampaignId,
          name: `Unproven Quality Biz ${testSuffix}`,
          category: 'Dentist',
          city: 'Dallas',
          country: 'US',
          source: 'test_hardening',
        },
      });

      const email = `unproven-${testSuffix}@qualitydental.com`;
      await db.contact.create({
        data: {
          businessId: biz.id,
          value: email,
          email,
          type: 'EMAIL',
          classification: 'BUSINESS_GENERIC',
          status: 'VERIFIED_PUBLIC',
          sourceUrl: null, // Missing provenance URL
        },
      });

      const lead = await db.lead.create({
        data: {
          businessId: biz.id,
          leadOpportunityScore: 90,
          classification: 'HOT',
          primaryContactType: 'EMAIL',
          primaryContactValue: email,
          recommendedService: 'WEBSITE_IMPROVEMENT',
        },
      });

      await db.outreach.create({
        data: {
          leadId: lead.id,
          channel: 'EMAIL',
          variant: 'VARIANT_A',
          subject: `Website for Unproven Quality Biz ${testSuffix}`,
          body: `Hello Unproven Quality Biz ${testSuffix} in Dallas,\n\nWe noticed some improvements.\n\nHASSAN RAMZAN`,
          primaryContactValue: email,
          primaryContactType: 'EMAIL',
          status: 'APPROVED',
          approvalStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: 'HUMAN_OPERATOR',
        },
      });

      const executor = new PilotExecutionService(db, validator);
      const preview = await executor.previewPilot(3, testCampaignId, {
        pilotCountry: 'US',
        allowTestRecord: true,
        includeTest: true,
      });

      const candidate = preview.candidates.find((c) => c.recipientEmail === email);
      expect(candidate).toBeDefined();
      expect(candidate?.candidateQuality).toBe('INVALID');
      expect(candidate?.blockingReason).toContain('EMAIL_SOURCE_NOT_VERIFIABLE');
    });

    it('20. executePilot without confirm must block candidate and never reach SMTP', async () => {
      const { safetyControls } = await import('../src/config/safety.js');
      safetyControls.updatePolicy({ outreachKillSwitch: false });
      const executor = new PilotExecutionService(db, validator);
      const result = await executor.executePilot({
        limit: 1,
        confirm: false,
        campaignId: testCampaignId,
        allowTestRecord: true,
      });

      expect(result.sent).toBe(0);
      expect(result.attempted).toBe(0);
      expect(result.confirmed).toBe(false);
      expect(result.message).toContain('explicit --confirm flag required');
      safetyControls.updatePolicy({ outreachKillSwitch: true });
    });
  });
});
