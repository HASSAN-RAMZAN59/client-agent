import { config } from '../../../config/env.js';
import { OutreachRepository } from '../../../database/repositories/outreach.repository.js';
import { OutreachGateService } from '../../personalization/hardening/outreach-gate.service.js';
import { MockOutreachProvider } from './mock-outreach.provider.js';
import { SmtpDeliveryProvider } from './smtp-delivery.provider.js';
import {
  OutreachDeliveryProvider,
  DeliveryResult,
  ExecutionBatchSummary,
  GateEvaluationResult,
} from '../../../types/index.js';
import { safeSleep } from '../../../utils/sleeper.js';
import { logger } from '../../../utils/logger.js';

export class OutreachExecutionService {
  private log = logger.child('OutreachExecutionService');
  private outreachRepo: OutreachRepository;
  private gateService: OutreachGateService;
  private provider: OutreachDeliveryProvider;

  constructor(
    provider?: OutreachDeliveryProvider,
    outreachRepo: OutreachRepository = new OutreachRepository(),
    gateService: OutreachGateService = new OutreachGateService()
  ) {
    this.outreachRepo = outreachRepo;
    this.gateService = gateService;

    if (provider) {
      this.provider = provider;
    } else if (config.DRY_RUN || !config.OUTREACH_ENABLED) {
      this.provider = new MockOutreachProvider();
    } else {
      this.provider = new SmtpDeliveryProvider();
    }
  }

  public getProviderName(): string {
    return this.provider.name;
  }

  /**
   * Pre-send inspection preview for a specific draft ID.
   */
  public async previewSend(draftId: string): Promise<{
    draft: any;
    gateResult: GateEvaluationResult;
    sendable: boolean;
    reasons: string[];
    warnings: string[];
    limits: {
      dailySent: number;
      dailyMax: number;
      runMax: number;
      cooldownDays: number;
      dryRun: boolean;
      outreachEnabled: boolean;
    };
  }> {
    const draft = await this.outreachRepo.getDraftById(draftId);
    if (!draft) {
      throw new Error(`Draft with ID "${draftId}" not found.`);
    }

    const gateResult = await this.gateService.evaluateDraft(draftId);
    const dailySent = await this.outreachRepo.getDailySentCount();

    const reasons: string[] = [...gateResult.reasons];
    const warnings: string[] = [...gateResult.warnings];

    if (draft.status !== 'READY_TO_SEND') {
      reasons.push(`Draft status is "${draft.status}" (must be "READY_TO_SEND" via explicit human approval).`);
    }

    if (dailySent >= config.MAX_EMAILS_PER_DAY && !config.DRY_RUN) {
      reasons.push(`Daily email limit reached (${dailySent}/${config.MAX_EMAILS_PER_DAY}).`);
    }

    if (!config.OUTREACH_ENABLED) {
      warnings.push('Global kill switch OUTREACH_ENABLED=false (Execution will be simulated or blocked).');
    }

    if (config.DRY_RUN) {
      warnings.push('DRY_RUN=true is active (Simulated execution only; 0 network emails sent).');
    }

    const sendable = reasons.length === 0 && draft.status === 'READY_TO_SEND';

    return {
      draft,
      gateResult,
      sendable,
      reasons,
      warnings,
      limits: {
        dailySent,
        dailyMax: config.MAX_EMAILS_PER_DAY,
        runMax: config.MAX_EMAILS_PER_RUN,
        cooldownDays: config.OUTREACH_BUSINESS_COOLDOWN_DAYS,
        dryRun: config.DRY_RUN,
        outreachEnabled: config.OUTREACH_ENABLED,
      },
    };
  }

  /**
   * Controlled execution of human-approved READY_TO_SEND drafts.
   */
  public async executeBatch(options: {
    limit?: number;
    dryRun?: boolean;
    draftId?: string;
  } = {}): Promise<ExecutionBatchSummary> {
    const isDryRun = options.dryRun !== undefined ? options.dryRun : config.DRY_RUN;
    const requestedLimit = options.limit || config.MAX_EMAILS_PER_RUN;

    // Safety Constraint: CLI flag cannot override configured MAX_EMAILS_PER_RUN upward
    const effectiveLimit = Math.min(requestedLimit, config.MAX_EMAILS_PER_RUN);

    this.log.info(
      `Initiating outreach execution run (Requested: ${requestedLimit}, Effective Limit: ${effectiveLimit}, DryRun: ${isDryRun}, OutreachEnabled: ${config.OUTREACH_ENABLED})`
    );

    // Fail-Closed Check if real send requested but OUTREACH_ENABLED is false
    if (!isDryRun && !config.OUTREACH_ENABLED) {
      this.log.warn('Real delivery blocked: OUTREACH_ENABLED is false. Failing closed.');
      return {
        totalEligible: 0,
        attempted: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        dryRun: isDryRun,
        results: [],
      };
    }

    // Daily Limit Check
    const dailySent = await this.outreachRepo.getDailySentCount();
    if (dailySent >= config.MAX_EMAILS_PER_DAY && !isDryRun) {
      this.log.warn(
        `Daily outreach limit reached (${dailySent}/${config.MAX_EMAILS_PER_DAY}). Halting batch execution.`
      );
      return {
        totalEligible: 0,
        attempted: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        dryRun: isDryRun,
        results: [],
      };
    }

    const availableDailyQuota = Math.max(0, config.MAX_EMAILS_PER_DAY - dailySent);
    const batchLimit = Math.min(effectiveLimit, isDryRun ? effectiveLimit : availableDailyQuota);

    // Fetch approved READY_TO_SEND drafts (targeted draftId or batch query)
    let eligibleDrafts: any[] = [];
    if (options.draftId) {
      const single = await this.outreachRepo.getDraftById(options.draftId);
      if (single && single.status === 'READY_TO_SEND') {
        eligibleDrafts = [single];
      }
    } else {
      eligibleDrafts = await this.outreachRepo.getReadyToSendDrafts(batchLimit);
    }

    const summary: ExecutionBatchSummary = {
      totalEligible: eligibleDrafts.length,
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      dryRun: isDryRun,
      results: [],
    };

    if (eligibleDrafts.length === 0) {
      this.log.info('No READY_TO_SEND drafts found for delivery execution.');
      return summary;
    }

    for (let i = 0; i < eligibleDrafts.length; i++) {
      const draft = eligibleDrafts[i];

      // 1. FINAL PRE-SEND GATE CHECK
      const gateResult = await this.gateService.evaluateDraft(draft.id);
      if (!gateResult.allowed) {
        this.log.warn(
          `Draft ${draft.id.substring(0, 8)} failed final pre-send gate: ${gateResult.reasons.join('; ')}. Skipping.`
        );
        summary.skipped++;
        continue;
      }

      // 2. ATOMIC CLAIM (READY_TO_SEND -> SENDING)
      const claimed = await this.outreachRepo.claimDraftForSending(draft.id);
      if (!claimed) {
        this.log.warn(`Draft ${draft.id.substring(0, 8)} could not be claimed (ALREADY_CLAIMED). Skipping.`);
        summary.skipped++;
        continue;
      }

      summary.attempted++;

      // 3. EXECUTE DELIVERY VIA PROVIDER
      const deliveryResult: DeliveryResult = await this.provider.send({
        outreachId: draft.id,
        leadId: draft.leadId,
        businessId: draft.lead.businessId,
        businessName: draft.lead.business.name,
        recipient: draft.primaryContactValue,
        recipientType: draft.primaryContactType || 'EMAIL',
        subject: draft.subject || 'Website note',
        body: draft.body,
        dryRun: isDryRun,
      });

      // 4. PERSIST DELIVERY OUTCOME
      if (deliveryResult.success) {
        await this.outreachRepo.markSent(draft.id, {
          messageId: deliveryResult.messageId,
          dryRun: isDryRun,
        });
        summary.sent++;
      } else {
        await this.outreachRepo.markFailed(
          draft.id,
          deliveryResult.error || 'Unknown delivery failure',
          isDryRun
        );
        summary.failed++;

        // If provider reports rate limiting, abort rest of batch
        if (deliveryResult.error && deliveryResult.error.includes('RATE_LIMITED')) {
          this.log.error('Provider rate limit reached. Halting current execution run.');
          summary.results.push(deliveryResult);
          break;
        }
      }

      summary.results.push(deliveryResult);

      // 5. SEQUENTIAL RATE LIMITING THROTTLE (except for last item)
      if (i < eligibleDrafts.length - 1) {
        await safeSleep(config.OUTREACH_MIN_DELAY_MS);
      }
    }

    return summary;
  }
}
