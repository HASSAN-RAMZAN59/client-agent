import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../../database/client.js';
import { SuppressionRepository } from '../../../database/repositories/suppression.repository.js';
import { OutreachRepository } from '../../../database/repositories/outreach.repository.js';
import { safetyControls } from '../../../config/safety.js';
import { config } from '../../../config/env.js';
import { PreSendValidationResult } from '../../../types/index.js';
import { createLogger } from '../../../utils/logger.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      if (!config.LIVE_PILOT_ENABLED) {
        reasons.push('PILOT_DISABLED');
      }
      if (!config.OUTREACH_ENABLED) {
        reasons.push('OUTREACH_DISABLED');
      }
      if (config.DRY_RUN && options.strictLiveMode) {
        reasons.push('DRY_RUN_ACTIVE');
      }
      if (safetyControls.isKillSwitchActive()) {
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

    // 1. Channel Exclusivity Check (Strictly EMAIL)
    if (outreach.channel === 'PHONE') {
      reasons.push('PHONE_CHANNEL');
    } else if (outreach.channel === 'CONTACT_FORM') {
      reasons.push('CONTACT_FORM_CHANNEL');
    } else if (outreach.channel !== 'EMAIL') {
      reasons.push('INVALID_CHANNEL');
    }

    // 2. Kill Switch
    const killSwitchActive = safetyControls.isKillSwitchActive();
    if (killSwitchActive) {
      reasons.push('KILL_SWITCH_ACTIVE');
    }

    // 3. Human Approval Check
    const hasApproval =
      Boolean(outreach.approvedAt) &&
      ['APPROVED', 'EDITED_AND_APPROVED', 'READY_TO_SEND'].includes(outreach.status);
    if (!hasApproval) {
      reasons.push('NOT_HUMAN_APPROVED', 'HUMAN_APPROVAL_REQUIRED');
    }

    // 4. Business Identity Check
    const validBusinessIdentity = Boolean(
      business?.name &&
        business.name.trim().length >= 2 &&
        !business.name.toLowerCase().includes('unknown business')
    );
    if (!validBusinessIdentity) {
      reasons.push('INVALID_BUSINESS_IDENTITY');
    }

    // 5. Contact & Verified Public Email Check
    const contactValue =
      outreach.primaryContactValue ||
      lead?.primaryContactValue ||
      business?.contacts?.find((c) => c.type === 'EMAIL')?.value;
    const isEmailChannel = outreach.channel === 'EMAIL';
    const validEmailFormat = Boolean(contactValue && EMAIL_REGEX.test(contactValue.trim()));
    const matchingContact = business?.contacts?.find(
      (c) => c.value?.toLowerCase() === contactValue?.toLowerCase()
    );
    const isGuessed = Boolean(
      matchingContact?.status === 'NONE_FOUND' || matchingContact?.status === 'INVALID'
    );

    if (!isEmailChannel || !validEmailFormat) {
      reasons.push('EMAIL_NOT_VERIFIED');
    }

    if (isGuessed) {
      reasons.push('GUESSED_EMAIL', 'GUESSED_EMAIL_PROHIBITED');
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

    // 10. Identity & Location Match
    const correctBusinessName = Boolean(business?.name && body.includes(business.name));
    const correctCity = Boolean(!business?.city || body.includes(business.city));
    if (!correctBusinessName) {
      warnings.push('BUSINESS_NAME_NOT_MENTIONED_IN_BODY');
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
    };
  }
}

export const preSendValidator = new PreSendValidator();
