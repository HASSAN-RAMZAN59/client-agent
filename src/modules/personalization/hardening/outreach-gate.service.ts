import { config } from '../../../config/env.js';
import { OutreachRepository } from '../../../database/repositories/outreach.repository.js';
import { SuppressionRepository } from '../../../database/repositories/suppression.repository.js';
import { buildPersonalizationContext } from '../personalization-context.builder.js';
import { EvidenceValidator } from './evidence-validator.js';
import { BusinessIdentityValidator } from './business-identity.validator.js';
import { OutreachQualityEvaluator } from './outreach-quality.evaluator.js';
import { ContentHasher } from './content-hasher.js';
import {
  GateEvaluationResult,
  OutreachLifecycleStatus,
  QualityBand,
} from '../../../types/index.js';
import { logger } from '../../../utils/logger.js';

export class OutreachGateService {
  private log = logger.child('OutreachGateService');
  private outreachRepo: OutreachRepository;
  private suppressionRepo: SuppressionRepository;

  constructor(
    outreachRepo: OutreachRepository = new OutreachRepository(),
    suppressionRepo: SuppressionRepository = new SuppressionRepository()
  ) {
    this.outreachRepo = outreachRepo;
    this.suppressionRepo = suppressionRepo;
  }

  /**
   * Evaluates all 10 quality, compliance, suppression, and safety dimensions for a draft.
   */
  public async evaluateDraft(draftId: string): Promise<GateEvaluationResult> {
    const draft = await this.outreachRepo.getDraftById(draftId);
    if (!draft) {
      throw new Error(`Outreach draft with ID "${draftId}" not found.`);
    }

    const context = await buildPersonalizationContext(draft.leadId);
    const reasons: string[] = [];
    const warnings: string[] = [];

    // 1. Evidence Validation (No Hallucinations)
    const evidenceResult = EvidenceValidator.validate(draft.subject || '', draft.body, context);
    if (!evidenceResult.valid) {
      reasons.push(...evidenceResult.reasons);
    }
    warnings.push(...evidenceResult.warnings);

    // 2. Business Identity Validation
    const identityResult = BusinessIdentityValidator.validate(
      draft.primaryContactValue,
      draft.primaryContactType,
      context
    );
    if (!identityResult.valid) {
      reasons.push(...identityResult.reasons);
    }
    warnings.push(...identityResult.warnings);

    // 3. Multi-Factor Quality Score & Quality Band
    const qualityResult = OutreachQualityEvaluator.evaluate({
      subject: draft.subject || '',
      body: draft.body,
      variant: draft.variant as import('../../../types/index.js').OutreachVariant,
      context,
      evidenceValid: evidenceResult.valid,
      identityValid: identityResult.valid,
    });
    if (qualityResult.blockedReasons.length > 0) {
      reasons.push(...qualityResult.blockedReasons);
    }
    warnings.push(...qualityResult.warnings);

    // 4. Suppression List Check (Email, Domain, Phone, Business)
    const suppressionCheck = await this.suppressionRepo.checkEntitySuppression({
      email: draft.primaryContactType === 'EMAIL' ? draft.primaryContactValue : null,
      websiteUrl: context.business.website,
      phone: draft.primaryContactType === 'PHONE' ? draft.primaryContactValue : context.business.phone,
      businessName: context.business.name,
      businessId: draft.lead.businessId,
    });

    const isSuppressed = suppressionCheck.suppressed;
    if (isSuppressed) {
      reasons.push(`Target is on suppression list (Reason: ${suppressionCheck.reason}, Match: ${suppressionCheck.match}).`);
    }

    // 5. Duplicate & Content-Hash Check
    const contentHash = ContentHasher.hashDraft(draft.subject || '', draft.body);
    const duplicate = await this.outreachRepo.findDuplicateDraftByHash(contentHash, draft.id);
    const isDuplicate = !!duplicate && duplicate.status === 'SENT';
    if (isDuplicate) {
      reasons.push(`Identical message content was already dispatched in draft ${duplicate.id.substring(0, 8)}.`);
    }

    // 6. Cooldown Check
    const cooldownDays = config.OUTREACH_BUSINESS_COOLDOWN_DAYS;
    const cooldownCheck = await this.outreachRepo.checkCooldown(
      draft.lead.businessId,
      draft.primaryContactValue,
      cooldownDays
    );
    if (cooldownCheck.inCooldown && cooldownCheck.lastContactAt) {
      reasons.push(
        `Business/contact is in outreach cooldown (Last contact: ${cooldownCheck.lastContactAt.toISOString().split('T')[0]}, Cooldown: ${cooldownDays} days).`
      );
    }

    // 7. Freshness & Staleness Check
    let isStale = false;
    const now = Date.now();
    if (draft.expiresAt && draft.expiresAt.getTime() < now) {
      isStale = true;
      reasons.push(`Draft has expired on ${draft.expiresAt.toISOString().split('T')[0]} and requires re-audit.`);
    }

    // Check underlying website audit age
    const auditUpdatedAt = draft.lead.business.audits[0]?.updatedAt;
    if (auditUpdatedAt) {
      const auditAgeDays = (now - new Date(auditUpdatedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (auditAgeDays > config.AUDIT_RE_AUDIT_INTERVAL_DAYS * 2) {
        isStale = true;
        reasons.push(`Underlying website audit is ${Math.round(auditAgeDays)} days old (Threshold: ${config.AUDIT_RE_AUDIT_INTERVAL_DAYS * 2} days).`);
      }
    }

    // 8. Human Approval Status
    const isApproved = !!draft.approvedAt && draft.status === 'APPROVED';

    // 9. Global Safety Configuration Check
    if (!config.OUTREACH_ENABLED) {
      warnings.push('Global safety switch OUTREACH_ENABLED is false (Sending is disabled).');
    }
    if (config.DRY_RUN) {
      warnings.push('Global DRY_RUN is active (Outreach operates in simulation mode only).');
    }

    // Determine Final Status
    let status: OutreachLifecycleStatus = draft.status as OutreachLifecycleStatus;

    if (isSuppressed) {
      status = 'SUPPRESSED';
    } else if (isStale) {
      status = 'STALE';
    } else if (qualityResult.qualityBand === 'REJECTED' || !evidenceResult.valid || !identityResult.valid) {
      status = 'REVIEW_REQUIRED';
    } else if (draft.status === 'APPROVED' || draft.status === 'READY_TO_SEND') {
      if (reasons.length === 0) {
        status = 'READY_TO_SEND';
      } else {
        status = 'REVIEW_REQUIRED';
      }
    } else {
      status = 'REVIEW_REQUIRED';
    }

    const allowed = reasons.length === 0 && status === 'READY_TO_SEND';

    return {
      allowed,
      status,
      score: qualityResult.score,
      qualityBand: qualityResult.qualityBand,
      reasons,
      warnings,
      evidenceValid: evidenceResult.valid,
      identityValid: identityResult.valid,
      isSuppressed,
      isDuplicate,
      isStale,
      isApproved,
    };
  }

  /**
   * Human operator explicit approval action.
   */
  public async approveDraft(
    draftId: string,
    operator: string = 'HUMAN_OPERATOR'
  ): Promise<{ success: boolean; status: OutreachLifecycleStatus; message: string; gateResult: GateEvaluationResult }> {
    const gateResult = await this.evaluateDraft(draftId);

    if (gateResult.isSuppressed) {
      return {
        success: false,
        status: 'SUPPRESSED',
        message: `Cannot approve draft: Target is on suppression list (${gateResult.reasons.join('; ')}).`,
        gateResult,
      };
    }

    if (!gateResult.evidenceValid || !gateResult.identityValid) {
      return {
        success: false,
        status: 'REVIEW_REQUIRED',
        message: `Cannot approve draft: Identity or evidence check failed (${gateResult.reasons.join('; ')}).`,
        gateResult,
      };
    }

    if (gateResult.isStale) {
      return {
        success: false,
        status: 'STALE',
        message: `Cannot approve draft: Draft or underlying audit is stale. Please re-audit and regenerate.`,
        gateResult,
      };
    }

    // Persist human approval
    const updated = await this.outreachRepo.approveDraft(draftId, operator);

    this.log.info(`Draft ${draftId} approved by ${operator}. Status set to READY_TO_SEND.`);

    return {
      success: true,
      status: 'READY_TO_SEND',
      message: `Draft ${draftId.substring(0, 8)} successfully approved by ${operator}. Marked READY_TO_SEND.`,
      gateResult,
    };
  }

  /**
   * Human operator explicit rejection action.
   */
  public async rejectDraft(
    draftId: string,
    reason: string,
    operator: string = 'HUMAN_OPERATOR'
  ): Promise<{ success: boolean; status: OutreachLifecycleStatus; message: string }> {
    await this.outreachRepo.rejectDraft(draftId, reason, operator);
    this.log.info(`Draft ${draftId} rejected by ${operator} (Reason: ${reason}).`);

    return {
      success: true,
      status: 'REJECTED',
      message: `Draft ${draftId.substring(0, 8)} rejected (Reason: "${reason}").`,
    };
  }
}
