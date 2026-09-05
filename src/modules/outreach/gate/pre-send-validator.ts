import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../../database/client.js';
import { SuppressionRepository } from '../../../database/repositories/suppression.repository.js';
import { OutreachRepository } from '../../../database/repositories/outreach.repository.js';
import { safetyControls } from '../../../config/safety.js';
import { config } from '../../../config/env.js';
import { PreSendValidationResult, OutreachDeliveryProvider, OutreachContextType } from '../../../types/index.js';
import { createLogger } from '../../../utils/logger.js';
import { isStrictlyValidEmail, normalizeCountryCode } from '../../../utils/email-validator.js';
import { ContentHasher } from '../../personalization/hardening/content-hasher.js';
import { SmtpDeliveryProvider } from '../execution/smtp-delivery.provider.js';
import { validateBusinessIdentity } from '../../discovery/identity-validator.js';

const PROHIBITED_FEAR_PATTERNS = [
  /losing\s+(revenue|money|thousands|millions)/i,
  /your\s+website\s+is\s+(broken|worthless|ruined|a\s+disaster)/i,
  /lawsuit\s+pending/i,
  /guarantee(d)?\s+(#1|first\s+page|10x|100x)/i,
  /you\s+are\s+losing\s+customers/i,
];

export interface LivePilotEligibilityOptions {
  checkEnvFlags?: boolean;
  checkDailyLimit?: boolean;
  strictLiveMode?: boolean;
  campaignId?: string;
  campaignCity?: string;
  campaignCountry?: string;
  campaignNiche?: string;
  allowTestRecord?: boolean;
  enforceTestCheck?: boolean;
  pilotCountry?: string;
  requireStrictProvenance?: boolean;
  dryRun?: boolean;
  checkProviderPolicy?: boolean;
  provider?: OutreachDeliveryProvider;
  outreachType?: OutreachContextType;
}

export interface LivePilotEligibilityResult extends PreSendValidationResult {
  eligible: boolean;
  blockReasonCode?: string;
}

export class PreSendValidator {
  private db: PrismaClient;
  private suppressionRepo: SuppressionRepository;
  private outreachRepo: OutreachRepository;
  private log = createLogger('PreSendValidator');

  constructor(
    customDb?: PrismaClient,
    customSuppressionRepo?: SuppressionRepository,
    customOutreachRepo?: OutreachRepository
  ) {
    this.db = customDb || getPrismaClient();
    this.suppressionRepo = customSuppressionRepo || new SuppressionRepository(this.db);
    this.outreachRepo = customOutreachRepo || new OutreachRepository(this.db);
  }

  public async getTodaySentCount(campaignId?: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const where: any = {
      sentAt: { gte: startOfDay },
      status: 'SENT',
      dryRun: false,
    };

    if (campaignId) {
      where.lead = { business: { campaignId } };
    }

    const sentToday = await this.db.outreach.count({
      where,
    });

    return sentToday;
  }

  public async isLivePilotEligible(
    outreachId: string,
    options: LivePilotEligibilityOptions = {}
  ): Promise<LivePilotEligibilityResult> {
    const baseResult = await this.validateOutreach(outreachId, options);
    const reasons = [...baseResult.reasons];

    if (options.checkEnvFlags) {
      if (!config.LIVE_PILOT_ENABLED && !options.dryRun) {
        reasons.push('PILOT_DISABLED');
      }
      if (!config.OUTREACH_ENABLED && !options.dryRun) {
        reasons.push('OUTREACH_DISABLED');
      }
      if (config.DRY_RUN && options.strictLiveMode && !options.dryRun) {
        reasons.push('DRY_RUN_ACTIVE');
      }
      if (safetyControls.isKillSwitchActive() && !options.dryRun) {
        if (!reasons.includes('KILL_SWITCH_ACTIVE')) {
          reasons.push('KILL_SWITCH_ACTIVE');
        }
      }
    }

    // Daily Limit Check
    if (options.checkDailyLimit) {
      const sentToday = await this.getTodaySentCount(options.campaignId);
      if (sentToday >= config.LIVE_PILOT_MAX_SENDS_PER_DAY) {
        reasons.push('DAILY_LIMIT_REACHED');
      }
    }

    // Provider Policy Gate (Requirement 5: Before live commercial outreach require BOTH LEGAL_COMPLIANCE_VALID and PROVIDER_POLICY_VALID)
    const checkProvider = options.checkProviderPolicy || (Boolean(options.checkEnvFlags || options.strictLiveMode) && !options.dryRun);
    if (checkProvider && !options.dryRun) {
      const provider = options.provider || new SmtpDeliveryProvider();
      const policy = provider.getProviderPolicyStatus({
        outreachType: options.outreachType || 'COLD_COMMERCIAL',
      });
      if (policy.status !== 'PERMITTED') {
        const reason = policy.reasonCode || 'OUTBOUND_PROVIDER_POLICY_UNSUPPORTED';
        if (!reasons.includes(reason)) {
          reasons.push(reason);
        }
      }
    }

    const eligible = reasons.length === 0;

    return {
      ...baseResult,
      allowed: eligible,
      eligible,
      status: eligible ? 'ALLOWED' : 'BLOCKED',
      reasons,
      blockReasonCode: reasons.length > 0 ? reasons[0] : undefined,
    };
  }

  public async validateOutreach(
    outreachId: string,
    options: LivePilotEligibilityOptions = {}
  ): Promise<PreSendValidationResult> {
    const outreach = await this.db.outreach.findUnique({
      where: { id: outreachId },
      include: {
        lead: {
          include: {
            business: {
              include: {
                audits: { orderBy: { createdAt: 'desc' }, take: 1 },
                contacts: true,
                campaign: true,
                campaignBusinesses: true,
              },
            },
          },
        },
      },
    });

    if (!outreach) {
      return {
        allowed: false,
        status: 'BLOCKED',
        reasons: ['OUTREACH_NOT_FOUND'],
        warnings: [],
        details: this.getDefaultDetails(false),
      };
    }

    const business = outreach.lead?.business;
    const lead = outreach.lead;
    const audit = business?.audits?.[0];
    const reasons: string[] = [];
    const warnings: string[] = [];

    // 0. Test Data Prohibited Gate (Absolute Isolation Barrier)
    if (!options?.allowTestRecord) {
      const isTest = this.checkIfTestRecord({
        business,
        contactValue: outreach.primaryContactValue || lead?.primaryContactValue,
        channel: outreach.channel,
      });
      if (isTest) {
        reasons.push('TEST_DATA_PROHIBITED');
      }
    }

    // 0b. Strict Campaign Membership & Configuration Gate
    const targetCampaignId = options.campaignId || business?.campaignId;
    let targetCampaign = business?.campaign;
    if (options.campaignId && (!targetCampaign || targetCampaign.id !== options.campaignId)) {
      targetCampaign = await this.db.campaign.findUnique({ where: { id: options.campaignId } });
    }

    if (options.campaignId) {
      const isLinkedToCampaign =
        business?.campaignId === options.campaignId ||
        business?.campaignBusinesses?.some((cb) => cb.campaignId === options.campaignId);

      if (!isLinkedToCampaign) {
        reasons.push('CAMPAIGN_MARKET_MISMATCH');
      }
    }

    if (targetCampaign) {
      const targetCountry = normalizeCountryCode(options.campaignCountry || targetCampaign.country);
      const bizCountry = normalizeCountryCode(business?.country);
      const targetCity = (options.campaignCity || targetCampaign.city || '').trim().toLowerCase();
      const bizCity = (business?.city || '').trim().toLowerCase();

      if (bizCountry !== targetCountry || (targetCity && bizCity !== targetCity)) {
        if (!reasons.includes('CAMPAIGN_MARKET_MISMATCH')) {
          reasons.push('CAMPAIGN_MARKET_MISMATCH');
        }
      }

      const targetNiche = options.campaignNiche || targetCampaign.niche;
      if (targetNiche && business?.category) {
        if (!this.isNicheMatch(business.category, targetNiche)) {
          if (!reasons.includes('CAMPAIGN_NICHE_MISMATCH')) {
            reasons.push('CAMPAIGN_NICHE_MISMATCH');
          }
        }
      }
    } else {
      if (options.campaignCity && business?.city) {
        if (business.city.trim().toLowerCase() !== options.campaignCity.trim().toLowerCase()) {
          reasons.push('CAMPAIGN_MARKET_MISMATCH');
        }
      }
      if (options.campaignNiche && business?.category) {
        if (!this.isNicheMatch(business.category, options.campaignNiche)) {
          reasons.push('CAMPAIGN_NICHE_MISMATCH');
        }
      }
    }

    // 1. Channel Exclusivity Check (Strictly EMAIL)
    if (outreach.channel === 'PHONE') {
      reasons.push('PHONE_CHANNEL');
    } else if (outreach.channel === 'CONTACT_FORM') {
      reasons.push('CONTACT_FORM_CHANNEL');
    } else if (outreach.channel !== 'EMAIL') {
      reasons.push('INVALID_CHANNEL');
    }

    // 2. Kill Switch (enforced for real live dispatch; safe mock simulation executes when dryRun === true)
    const killSwitchActive = safetyControls.isKillSwitchActive();
    if (killSwitchActive && !options.dryRun) {
      reasons.push('KILL_SWITCH_ACTIVE');
    }

    // 3. Human Approval & Content Immutability Check
    const hasApproval =
      Boolean(outreach.approvedAt) &&
      ['APPROVED', 'EDITED_AND_APPROVED', 'READY_TO_SEND'].includes(outreach.status);
    if (!hasApproval) {
      reasons.push('NOT_HUMAN_APPROVED', 'HUMAN_APPROVAL_REQUIRED');
    } else if (outreach.contentHash) {
      const currentSubject = outreach.finalSubject || outreach.subject || '';
      const currentBody = outreach.finalBody || outreach.body || '';
      const currentHash = ContentHasher.hashDraft(currentSubject, currentBody);
      if (currentHash !== outreach.contentHash) {
        reasons.push('CONTENT_CHANGED_AFTER_APPROVAL');
      }
    }

    // 4. Business Identity Check
    const name = business?.name ? business.name.trim() : '';
    const unsafeIdentityRegexes = [
      /(?:^|\b)(?:dentist|dentists|dentistry|dental|hvac|plumber|plumbing|doctor|lawyer|attorney|roofing|electrician|cleaning)\s+in\s+[a-zA-Z\s,.-]+/i,
      /^[a-zA-Z\s,.-]+,\s*(?:TX|CA|NY|FL|IL|PA|OH|GA|NC|MI|NJ|VA|WA|AZ|MA|TN|IN|MO|MD|WI|CO|MN|SC|AL|LA|KY|OR|OK|CT|UT|IA|NV|AR|MS|KS|NM|NE|ID|WV|HI|NH|ME|MT|RI|DE|SD|ND|AK|DC|USA)\s+(?:dentists?|dentistry|hvac|plumbers?|doctors?|lawyers?|attorneys?|services)/i,
      /(?:dentist|dentistry|dental|hvac|plumber|doctor|lawyer)\s+near\s+me/i,
      /(?:^|\b)(?:best|top|affordable|emergency|cheap)\s+(?:dentists?|hvac|plumbers?|doctors?)\s+in\s+[a-zA-Z\s,.-]+/i,
      /^(?:contact\s+us|home|about\s+us|welcome\s+to)\b/i,
      /\bdentists?\s+near\s+me\b/i,
      /\bdallas(?:,\s*tx)?\s+dentists?\b/i,
    ];
    const identityCheck = validateBusinessIdentity(name, {
      city: business?.city,
      country: business?.country,
      niche: business?.category,
    });
    const isUnsafeName = unsafeIdentityRegexes.some((rx) => rx.test(name)) || !identityCheck.isValid;

    const validBusinessIdentity = Boolean(
      name &&
        name.length >= 2 &&
        !name.toLowerCase().includes('unknown business') &&
        !isUnsafeName
    );
    if (!validBusinessIdentity) {
      if (isUnsafeName) {
        reasons.push('BUSINESS_IDENTITY_UNSAFE');
      } else {
        reasons.push('INVALID_BUSINESS_IDENTITY');
      }
    }

    // 4b. Lead Qualification & Contact Channel Gates
    if (lead?.classification === 'COLD') {
      reasons.push('COLD_LEAD_DISPATCH_PROHIBITED');
    }
    const hasValidLeadContact =
      lead?.primaryContactValue &&
      lead?.primaryContactType &&
      lead?.primaryContactType !== 'NONE' &&
      lead?.contactDiscoveryStatus !== 'NONE_FOUND';
    if (!hasValidLeadContact) {
      reasons.push('NO_CONTACT_LEAD');
    }

    // 5. Contact & Verified Public Email Check
    const contactValue =
      outreach.primaryContactValue ||
      lead?.primaryContactValue ||
      business?.contacts?.find((c) => c.type === 'EMAIL')?.value;
    const isEmailChannel = outreach.channel === 'EMAIL';
    const emailValidation = isStrictlyValidEmail(contactValue);
    const validEmailFormat = emailValidation.valid;
    const matchingContact = business?.contacts?.find(
      (c) => c.value?.toLowerCase() === contactValue?.toLowerCase()
    );
    const isGuessed = Boolean(
      matchingContact?.status === 'NONE_FOUND' || matchingContact?.status === 'INVALID'
    );
    const isPlatformContact = Boolean(matchingContact?.classification === 'PLATFORM_CONTACT');

    if (isPlatformContact) {
      reasons.push('PLATFORM_CONTACT_PROHIBITED');
    }

    if (!isEmailChannel || !validEmailFormat) {
      if (!validEmailFormat && contactValue) {
        reasons.push('INVALID_EMAIL_CONTACT');
      } else {
        reasons.push('EMAIL_NOT_VERIFIED');
      }
    }

    if (isGuessed) {
      reasons.push('GUESSED_EMAIL', 'GUESSED_EMAIL_PROHIBITED');
    }

    // 5a. Strict Provenance Gate for Live Pilot
    // LIVE EMAIL PILOT requires: VERIFIED_PUBLIC, exact sourceUrl present, valid discovery timestamp, not guessed/unverifiable
    const requireProvenance = options.requireStrictProvenance ?? true;
    if (requireProvenance && isEmailChannel) {
      const hasMatchingContact = Boolean(matchingContact);
      const isStatusVerifiedPublic = matchingContact?.status === 'VERIFIED_PUBLIC';
      const hasValidSourceUrl = Boolean(
        matchingContact?.sourceUrl &&
        matchingContact.sourceUrl.trim().length > 0 &&
        (matchingContact.sourceUrl.startsWith('http://') || matchingContact.sourceUrl.startsWith('https://'))
      );
      const hasVerificationTimestamp = Boolean(matchingContact?.discoveredAt || matchingContact?.createdAt);

      // Check directory/search snippet or non-official source exclusion: sourceUrl must belong to official website
      const isDirectoryOrOsmSource = Boolean(
        (matchingContact?.sourceUrl &&
          /google\.|yelp\.|yellowpages\.|bing\.|bbb\.org|facebook\.|tripadvisor\.|mapquest\.|openstreetmap\.org|overpass/i.test(
            matchingContact.sourceUrl
          )) ||
        matchingContact?.source === 'osm_overpass' ||
        (matchingContact?.sourceType && matchingContact.sourceType !== 'OFFICIAL_WEBSITE')
      );

      // Check emailAsFound match if present
      const emailAsFound = (matchingContact as any)?.emailAsFound;
      const emailAsFoundMatches = emailAsFound
        ? contactValue?.toLowerCase().trim() === emailAsFound.toLowerCase().trim()
        : true;

      if (
        !hasMatchingContact ||
        !isStatusVerifiedPublic ||
        !hasValidSourceUrl ||
        !hasVerificationTimestamp ||
        isDirectoryOrOsmSource ||
        !emailAsFoundMatches
      ) {
        reasons.push('EMAIL_SOURCE_NOT_VERIFIABLE');
      }
    }

    // 5b-pre. Pilot Country Gate (US-only first pilot)
    if (options.pilotCountry) {
      const targetCountry = normalizeCountryCode(options.pilotCountry);
      const bizCountry = normalizeCountryCode(business?.country);
      if (bizCountry && bizCountry !== targetCountry) {
        reasons.push('PILOT_COUNTRY_MISMATCH');
      }
    }

    // 5b. Location / Branch Mismatch Check
    if (contactValue && business?.city) {
      const emailPrefix = contactValue.split('@')[0]?.toLowerCase().trim() || '';
      const bizCity = business.city.toLowerCase().replace(/[^a-z0-9]/g, '');

      const knownBranchCities = [
        'cambridge',
        'ottawa',
        'montreal',
        'calgary',
        'vancouver',
        'edmonton',
        'hamilton',
        'london',
        'windsor',
        'kitchener',
        'waterloo',
        'brampton',
        'mississauga',
        'markham',
        'vaughan',
        'dallas',
        'houston',
        'austin',
        'sanantonio',
        'chicago',
        'newyork',
        'miami',
        'seattle',
      ];

      for (const city of knownBranchCities) {
        if (
          bizCity !== city &&
          (emailPrefix === city ||
            emailPrefix.startsWith(city + '.') ||
            emailPrefix.startsWith(city + '_') ||
            emailPrefix.startsWith(city + '-') ||
            (matchingContact?.sourceUrl && new RegExp(`/(?:locations?|offices?)[-_]${city}\\b`, 'i').test(matchingContact.sourceUrl)))
        ) {
          reasons.push('LOCATION_CONTACT_MISMATCH');
          break;
        }
      }
    }

    // 6. Suppression Check
    let isSuppressed = false;
    if (contactValue) {
      isSuppressed = await this.suppressionRepo.isSuppressed(contactValue);
      if (!isSuppressed && contactValue.includes('@')) {
        const domain = contactValue.split('@')[1];
        if (domain) {
          isSuppressed = await this.suppressionRepo.isSuppressed(domain);
        }
      }
    }
    if (isSuppressed) {
      reasons.push('SUPPRESSED_RECIPIENT', 'SUPPRESSED');
    }

    // 7. Cooldown Check
    let isCooldownActive = false;
    if (business?.id) {
      const cooldownDays = config.OUTREACH_BUSINESS_COOLDOWN_DAYS;
      const cooldownRes = await this.outreachRepo.checkCooldown(business.id, contactValue, cooldownDays);
      isCooldownActive = cooldownRes.inCooldown;
    }
    if (isCooldownActive) {
      reasons.push('COOLDOWN_ACTIVE');
    }

    // 8. Draft Validation & Grounding
    const subject = outreach.finalSubject || outreach.subject || '';
    const body = outreach.finalBody || outreach.body || '';
    const validDraft = subject.trim().length >= 5 && body.trim().length >= 20;
    if (!validDraft) {
      reasons.push('INVALID_DRAFT');
    }

    // 9. Prohibited Claims & Hallucinations
    let noProhibitedClaims = true;
    for (const pattern of PROHIBITED_FEAR_PATTERNS) {
      if (pattern.test(subject) || pattern.test(body)) {
        noProhibitedClaims = false;
        reasons.push('UNGROUNDED_CLAIM', 'UNGROUNDED_CLAIM_DETECTED');
        break;
      }
    }

    // Check if business has no website but copy claims outdated website
    const hasNoWebsite = !business?.website || audit?.status === 'NO_WEBSITE';
    if (
      hasNoWebsite &&
      (body.toLowerCase().includes('your website is outdated') ||
        body.toLowerCase().includes('your site is slow'))
    ) {
      noProhibitedClaims = false;
      reasons.push('HALLUCINATED_WEBSITE_DEFECT');
    }

    // 9b. Concrete Audit Evidence Requirement (Rejects undefined audit problems)
    const hasUndefinedInCopy =
      body.includes('Problem Detected = undefined') ||
      body.toLowerCase().includes('problem detected: undefined') ||
      subject.includes('undefined');

    const hasConcreteAuditIssue = Boolean(
      (audit?.loadTimeMs && audit.loadTimeMs > 0) ||
      (audit?.issuesJson && audit.issuesJson !== '[]' && audit.issuesJson !== 'null') ||
      (audit?.findings && audit.findings !== '[]' && audit.findings !== 'null') ||
      (audit?.opportunityFlags && audit.opportunityFlags !== '[]' && audit.opportunityFlags !== 'null') ||
      (audit?.mobileResponsive === false)
    );

    if (
      hasUndefinedInCopy ||
      (body.toLowerCase().includes('website needs modernization') && !hasConcreteAuditIssue)
    ) {
      reasons.push('UNDEFINED_AUDIT_PROBLEM');
    }

    // 10. Identity & Location Match
    const correctBusinessName = Boolean(business?.name && body.includes(business.name));
    const correctCity = Boolean(!business?.city || body.includes(business.city));
    if (!correctBusinessName) {
      warnings.push('BUSINESS_NAME_NOT_MENTIONED_IN_BODY');
    }

    // 11. US Commercial Email Compliance Gate (Postal Address & Opt-out)
    const isUSOutreach = !business?.country || ['US', 'USA', 'UNITED STATES'].includes(business.country.toUpperCase().trim());
    let legalComplianceValid = true;
    if (isEmailChannel && isUSOutreach) {
      // Postal Address Requirement (US CAN-SPAM requires valid physical postal address in message)
      const postalAddress = config.SENDER_POSTAL_ADDRESS ? config.SENDER_POSTAL_ADDRESS.trim() : '';
      if (!postalAddress || postalAddress.length < 5 || /^(todo|changeme|n\/a|none|placeholder)/i.test(postalAddress)) {
        reasons.push('SENDER_POSTAL_ADDRESS_REQUIRED');
        legalComplianceValid = false;
      } else if (!body.toLowerCase().includes(postalAddress.toLowerCase())) {
        reasons.push('SENDER_POSTAL_ADDRESS_MISSING_FROM_BODY');
        legalComplianceValid = false;
      }

      // Opt-out Footer Requirement
      const bodyLower = body.toLowerCase();
      const hasOptOut = bodyLower.includes('unsubscribe') || bodyLower.includes('opt out') || bodyLower.includes('opt-out');
      if (!hasOptOut) {
        reasons.push('OPT_OUT_FOOTER_REQUIRED');
        legalComplianceValid = false;
      }

      // Commercial Identification Requirement
      const hasCommercialId = bodyLower.includes('web development outreach') || bodyLower.includes('commercial outreach') || bodyLower.includes('outreach');
      if (!hasCommercialId) {
        warnings.push('COMMERCIAL_IDENTIFICATION_MISSING');
      }

      if (!legalComplianceValid && !reasons.includes('CAN_SPAM_COMPLIANCE_FAILED')) {
        reasons.push('CAN_SPAM_COMPLIANCE_FAILED');
      }
    }

    const provider = options.provider || new SmtpDeliveryProvider();
    const policyCheck = provider.getProviderPolicyStatus({
      outreachType: options.outreachType || 'COLD_COMMERCIAL',
    });
    const providerPolicyValid = policyCheck.status === 'PERMITTED';

    if (options.checkProviderPolicy && !options.dryRun && !providerPolicyValid) {
      const reason = policyCheck.reasonCode || 'OUTBOUND_PROVIDER_POLICY_UNSUPPORTED';
      if (!reasons.includes(reason)) {
        reasons.push(reason);
      }
    }

    const allowed = reasons.length === 0;

    const details = {
      hasHumanApproval: hasApproval,
      validBusinessIdentity,
      validVerifiedEmail: validEmailFormat,
      isGuessedEmail: isGuessed,
      isSuppressed,
      isCooldownActive,
      validDraft,
      noProhibitedClaims,
      noHallucinatedMetrics: true,
      correctBusinessName,
      correctCity,
      senderConfigured: Boolean(config.SMTP_FROM_NAME && config.SMTP_FROM_EMAIL),
      pilotLimitOk: true,
      killSwitchActive,
      legalComplianceValid,
      providerPolicyValid,
      providerPolicyStatus: policyCheck.status,
    };

    if (!allowed) {
      this.log.warn(`Pre-send validation blocked outreach [${outreachId}]: ${reasons.join(', ')}`);
    } else {
      this.log.info(`Pre-send validation passed for outreach [${outreachId}].`);
    }

    return {
      allowed,
      status: allowed ? 'ALLOWED' : 'BLOCKED',
      reasons,
      warnings,
      details,
    };
  }

  public checkIfTestRecord(params: {
    business?: { name?: string | null; source?: string | null } | null;
    contactValue?: string | null;
    channel?: string | null;
  }): boolean {
    const { business, contactValue, channel } = params;

    if (channel && channel.toLowerCase().includes('test')) return true;

    if (business) {
      const source = (business.source || '').toLowerCase();
      if (
        source.startsWith('test') ||
        source.includes('mock') ||
        source.includes('fixture') ||
        source === 'test_suite'
      ) {
        return true;
      }

      const name = (business.name || '').toLowerCase();
      const testPatterns = [
        /^test\b/i,
        /^execution biz/i,
        /^contact test/i,
        /^batchtest/i,
        /^phase11/i,
        /^approved biz/i,
        /^cooldown biz/i,
        /^suppressed/i,
        /\btest biz\b/i,
        /\bpersonalize test\b/i,
        /\bexpired biz\b/i,
        /\bsuppressed lead biz\b/i,
        /\bgate biz\b/i,
        /\bduplicate biz\b/i,
        /\bpilot test\b/i,
        /\bmock biz\b/i,
        /\bfixture biz\b/i,
        /\btest clinic\b/i,
        /\bscoring test\b/i,
        /\bunittest\b/i,
      ];

      if (testPatterns.some((pattern) => pattern.test(name))) {
        return true;
      }
    }

    if (contactValue) {
      const val = contactValue.toLowerCase();
      if (
        val.endsWith('@example.com') ||
        val.includes('testdentalcontacts') ||
        val.includes('test-') ||
        val.startsWith('test@') ||
        val.startsWith('unittest')
      ) {
        return true;
      }
    }

    return false;
  }

  public isNicheMatch(businessCategory: string, campaignNiche: string): boolean {
    if (!businessCategory || !campaignNiche) return false;
    const targetNiches = campaignNiche.split(',').map((n) => n.trim().toLowerCase()).filter(Boolean);
    const cat = businessCategory.toLowerCase().trim();

    for (const target of targetNiches) {
      if (target === 'dentist' || target === 'dental') {
        if (
          cat.includes('dent') ||
          cat.includes('orthodont') ||
          cat.includes('endodont') ||
          cat.includes('periodont') ||
          cat.includes('oral')
        ) {
          return true;
        }
      } else if (target === 'hvac' || target === 'heating' || target === 'air conditioning') {
        if (
          cat.includes('hvac') ||
          cat.includes('air condition') ||
          cat.includes('heating') ||
          cat.includes('cooling') ||
          cat.includes('furnace') ||
          cat.includes('heat')
        ) {
          return true;
        }
      } else {
        if (cat.includes(target) || target.includes(cat)) {
          return true;
        }
      }
    }
    return false;
  }

  private getDefaultDetails(passed: boolean) {
    return {
      hasHumanApproval: passed,
      validBusinessIdentity: passed,
      validVerifiedEmail: passed,
      isGuessedEmail: !passed,
      isSuppressed: !passed,
      isCooldownActive: !passed,
      validDraft: passed,
      noProhibitedClaims: passed,
      noHallucinatedMetrics: passed,
      correctBusinessName: passed,
      correctCity: passed,
      senderConfigured: passed,
      pilotLimitOk: passed,
      killSwitchActive: !passed,
      legalComplianceValid: passed,
      providerPolicyValid: passed,
      providerPolicyStatus: (passed ? 'PERMITTED' : 'UNSUPPORTED') as import('../../../types/index.js').ProviderPolicyStatus,
    };
  }
}

export const preSendValidator = new PreSendValidator();
