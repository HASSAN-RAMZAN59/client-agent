import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../../database/client.js';
import { PreSendValidator } from '../gate/pre-send-validator.js';
import { SmtpDeliveryProvider } from './smtp-delivery.provider.js';
import { MockOutreachProvider } from './mock-outreach.provider.js';
import { safetyControls } from '../../../config/safety.js';
import { config } from '../../../config/env.js';
import { createLogger } from '../../../utils/logger.js';
import { normalizeEmail } from '../../discovery/normalizer.js';
import { DeliveryResult } from '../../../types/index.js';

export interface PilotExecutionParams {
  limit?: number;
  confirm?: boolean;
  dryRun?: boolean;
  campaignId?: string;
  pilotRunId?: string;
}

export interface PilotCandidateSummary {
  outreachId: string;
  businessName: string;
  recipientEmail: string;
  emailClassification: string;
  subject: string;
  leadScore: number;
  leadClass: string;
  salesAngle: string;
  approvalStatus: string;
  eligible: boolean;
  blockingReason?: string;
  isSuppressed: boolean;
  isCooldownActive: boolean;
  hasHumanApproval: boolean;
}

export interface PilotPreviewReport {
  timestamp: Date;
  candidates: PilotCandidateSummary[];
  eligibleCount: number;
  blockedCount: number;
  networkSends: number;
  remainingDailyCapacity: number;
  safetyState: {
    dryRun: boolean;
    outreachEnabled: boolean;
    livePilotEnabled: boolean;
    killSwitchActive: boolean;
    maxPilotLimit: number;
    dailyLimit: number;
  };
}

export interface PilotExecutionReport {
  pilotRunId: string;
  timestamp: Date;
  startTime: Date;
  endTime: Date;
  safetyState: {
    dryRun: boolean;
    outreachEnabled: boolean;
    livePilotEnabled: boolean;
    killSwitchActive: boolean;
    maxPilotLimit: number;
    dailyLimit: number;
  };
  totalEligible: number;
  candidates: PilotCandidateSummary[];
  attempted: number;
  sent: number;
  simulated: number;
  blocked: number;
  failed: number;
  unknown: number;
  duplicateBlocked: number;
  remainingDailyCapacity: number;
  results: DeliveryResult[];
  confirmed: boolean;
  message: string;
}

export class PilotExecutionService {
  private db: PrismaClient;
  private validator: PreSendValidator;
  private smtpProvider: SmtpDeliveryProvider;
  private mockProvider: MockOutreachProvider;
  private log = createLogger('PilotExecutionService');

  constructor(
    customDb?: PrismaClient,
    customValidator?: PreSendValidator,
    customSmtpProvider?: SmtpDeliveryProvider
  ) {
    this.db = customDb || getPrismaClient();
    this.validator = customValidator || new PreSendValidator(this.db);
    this.smtpProvider = customSmtpProvider || new SmtpDeliveryProvider();
    this.mockProvider = new MockOutreachProvider();
  }

  public async previewPilot(limit: number = 3, campaignId?: string): Promise<PilotPreviewReport> {
    const policy = safetyControls.getPolicy();
    const hardLimit = Math.min(limit, config.LIVE_PILOT_MAX_SENDS_PER_RUN, 3);
    const where: any = { channel: 'EMAIL' };

    if (campaignId) {
      where.lead = { business: { campaignId } };
    }

    const outreaches = await this.db.outreach.findMany({
      where,
      include: {
        lead: {
          include: {
            business: {
              include: {
                contacts: true,
                audits: { orderBy: { createdAt: 'desc' }, take: 1 },
              },
            },
          },
        },
      },
      take: hardLimit,
      orderBy: { lead: { leadOpportunityScore: 'desc' } },
    });

    const candidates: PilotCandidateSummary[] = [];
    let eligibleCount = 0;
    let blockedCount = 0;

    for (const o of outreaches) {
      const b = o.lead?.business;
      const l = o.lead;
      const matchingContact = b?.contacts?.find((c) => c.type === 'EMAIL');
      const recipient = o.primaryContactValue || matchingContact?.value || '';

      let salesAngleText = 'Website improvement opportunity';
      if (l?.salesAngle) {
        try {
          const parsed = JSON.parse(l.salesAngle);
          salesAngleText = parsed.problem || parsed.opportunity || parsed.reason || l.salesAngle;
        } catch {
          salesAngleText = l.salesAngle;
        }
      }

      const eligibility = await this.validator.isLivePilotEligible(o.id, { checkEnvFlags: false });

      if (eligibility.eligible) {
        eligibleCount++;
      } else {
        blockedCount++;
      }

      candidates.push({
        outreachId: o.id,
        businessName: b?.name || 'Unknown Business',
        recipientEmail: recipient,
        emailClassification: matchingContact?.classification || 'BUSINESS_GENERIC',
        subject: o.finalSubject || o.subject || 'Website Consultation',
        leadScore: l?.leadOpportunityScore || 0,
        leadClass: l?.classification || 'WARM',
        salesAngle: salesAngleText,
        approvalStatus: o.approvalStatus || (o.approvedAt ? 'APPROVED' : 'REVIEW_REQUIRED'),
        eligible: eligibility.eligible,
        blockingReason: eligibility.reasons.length > 0 ? eligibility.reasons.join(', ') : undefined,
        isSuppressed: eligibility.details.isSuppressed,
        isCooldownActive: eligibility.details.isCooldownActive,
        hasHumanApproval: eligibility.details.hasHumanApproval,
      });
    }

    const sentToday = await this.validator.getTodaySentCount();
    const remainingDailyCapacity = Math.max(0, config.LIVE_PILOT_MAX_SENDS_PER_DAY - sentToday);

    return {
      timestamp: new Date(),
      candidates,
      eligibleCount,
      blockedCount,
      networkSends: 0,
      remainingDailyCapacity,
      safetyState: {
        dryRun: policy.isDryRun,
        outreachEnabled: config.OUTREACH_ENABLED,
        livePilotEnabled: config.LIVE_PILOT_ENABLED,
        killSwitchActive: policy.outreachKillSwitch,
        maxPilotLimit: config.LIVE_PILOT_MAX_SENDS_PER_RUN,
        dailyLimit: config.LIVE_PILOT_MAX_SENDS_PER_DAY,
      },
    };
  }

  public async getPilotCandidates(limit: number = 3, campaignId?: string): Promise<PilotCandidateSummary[]> {
    const preview = await this.previewPilot(limit, campaignId);
    return preview.candidates;
  }

  public async executePilot(params: PilotExecutionParams): Promise<PilotExecutionReport> {
    const startTime = new Date();
    const pilotRunId = params.pilotRunId || `run_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const policy = safetyControls.getPolicy();

    // Enforce hard server-side limits: CLI parameter cannot exceed hard cap (3)
    const effectiveLimit = Math.min(
      params.limit || config.LIVE_PILOT_MAX_SENDS_PER_RUN,
      config.LIVE_PILOT_MAX_SENDS_PER_RUN,
      3
    );

    const isLiveMode =
      !policy.isDryRun &&
      config.OUTREACH_ENABLED &&
      config.LIVE_PILOT_ENABLED &&
      !policy.outreachKillSwitch;

    const sentToday = await this.validator.getTodaySentCount(params.campaignId);
    let remainingDailyCapacity = Math.max(0, config.LIVE_PILOT_MAX_SENDS_PER_DAY - sentToday);

    const safetyState = {
      dryRun: policy.isDryRun,
      outreachEnabled: config.OUTREACH_ENABLED,
      livePilotEnabled: config.LIVE_PILOT_ENABLED,
      killSwitchActive: policy.outreachKillSwitch,
      maxPilotLimit: config.LIVE_PILOT_MAX_SENDS_PER_RUN,
      dailyLimit: config.LIVE_PILOT_MAX_SENDS_PER_DAY,
    };

    // 1. Kill switch immediate check
    if (policy.outreachKillSwitch) {
      this.log.warn('Execution blocked: OUTREACH KILL SWITCH ACTIVE — NO OUTBOUND MESSAGES PERMITTED');
      return {
        pilotRunId,
        timestamp: new Date(),
        startTime,
        endTime: new Date(),
        safetyState,
        totalEligible: 0,
        candidates: [],
        attempted: 0,
        sent: 0,
        simulated: 0,
        blocked: 0,
        failed: 0,
        unknown: 0,
        duplicateBlocked: 0,
        remainingDailyCapacity,
        results: [],
        confirmed: Boolean(params.confirm),
        message: 'OUTREACH KILL SWITCH ACTIVE — NO OUTBOUND MESSAGES PERMITTED',
      };
    }

    const preview = await this.previewPilot(effectiveLimit, params.campaignId);
    const candidates = preview.candidates;

    // 2. Explicit --confirm check
    if (!params.confirm) {
      return {
        pilotRunId,
        timestamp: new Date(),
        startTime,
        endTime: new Date(),
        safetyState,
        totalEligible: preview.eligibleCount,
        candidates,
        attempted: 0,
        sent: 0,
        simulated: 0,
        blocked: preview.blockedCount,
        failed: 0,
        unknown: 0,
        duplicateBlocked: 0,
        remainingDailyCapacity,
        results: [],
        confirmed: false,
        message: 'LIVE PILOT NOT EXECUTED: Reason: explicit --confirm flag required.',
      };
    }

    // 3. Daily capacity check (for live mode)
    if (isLiveMode && remainingDailyCapacity <= 0) {
      this.log.warn('Execution blocked: DAILY PILOT SEND LIMIT REACHED (3/3 sends completed today)');
      return {
        pilotRunId,
        timestamp: new Date(),
        startTime,
        endTime: new Date(),
        safetyState,
        totalEligible: 0,
        candidates: [],
        attempted: 0,
        sent: 0,
        simulated: 0,
        blocked: 0,
        failed: 0,
        unknown: 0,
        duplicateBlocked: 0,
        remainingDailyCapacity: 0,
        results: [],
        confirmed: Boolean(params.confirm),
        message: 'LIVE PILOT NOT EXECUTED: Daily send limit of 3 emails already reached today.',
      };
    }

    let sent = 0;
    let simulated = 0;
    let blocked = 0;
    let failed = 0;
    let unknown = 0;
    let duplicateBlocked = 0;
    const results: DeliveryResult[] = [];
    const processedEmails = new Set<string>();

    for (const candidate of candidates) {
      const normalized = normalizeEmail(candidate.recipientEmail);

      // Check remaining daily capacity inside batch
      if (sent >= remainingDailyCapacity || sent >= config.LIVE_PILOT_MAX_SENDS_PER_RUN) {
        blocked++;
        continue;
      }

      // Idempotency / Duplicate protection within batch
      if (processedEmails.has(normalized)) {
        duplicateBlocked++;
        blocked++;
        results.push({
          success: false,
          status: 'FAILED',
          attemptedAt: new Date(),
          error: 'DUPLICATE_SEND_BLOCKED',
          providerName: 'IdempotencyGuard',
          dryRun: !isLiveMode,
        });
        continue;
      }
      processedEmails.add(normalized);

      // Immediate pre-send atomic check
      if (safetyControls.isKillSwitchActive()) {
        blocked++;
        results.push({
          success: false,
          status: 'FAILED',
          attemptedAt: new Date(),
          error: 'KILL_SWITCH_TRIGGERED_DURING_RUN',
          providerName: 'SafetyGuard',
          dryRun: !isLiveMode,
        });
        break;
      }

      const eligibility = await this.validator.isLivePilotEligible(candidate.outreachId, {
        checkEnvFlags: false,
      });

      if (!eligibility.eligible) {
        blocked++;
        results.push({
          success: false,
          status: 'FAILED',
          attemptedAt: new Date(),
          error: eligibility.reasons.join(', '),
          providerName: 'PreSendValidator',
          dryRun: !isLiveMode,
        });
        continue;
      }

      // Retrieve fresh outreach record
      const outreachRecord = await this.db.outreach.findUnique({
        where: { id: candidate.outreachId },
        include: { lead: { include: { business: true } } },
      });

      if (!outreachRecord || outreachRecord.status === 'SENT') {
        duplicateBlocked++;
        blocked++;
        continue;
      }

      // Mark status as SENDING
      await this.db.outreach.update({
        where: { id: candidate.outreachId },
        data: { status: 'SENDING', attemptedAt: new Date() },
      });

      // Prepare delivery payload
      const deliveryParams = {
        outreachId: outreachRecord.id,
        leadId: outreachRecord.leadId,
        businessId: outreachRecord.lead?.businessId || '',
        businessName: outreachRecord.lead?.business?.name || candidate.businessName,
        recipient: candidate.recipientEmail,
        recipientType: 'EMAIL',
        subject: outreachRecord.finalSubject || outreachRecord.subject || candidate.subject,
        body: outreachRecord.finalBody || outreachRecord.body,
        dryRun: !isLiveMode,
      };

      let result: DeliveryResult;

      try {
        if (isLiveMode) {
          this.log.info(`[LIVE PILOT DISPATCH] Sending real email to ${candidate.recipientEmail}`);
          result = await this.smtpProvider.send(deliveryParams);
        } else {
          this.log.info(`[SAFE SIMULATION] Simulating email delivery to ${candidate.recipientEmail}`);
          result = await this.mockProvider.send(deliveryParams);
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        result = {
          success: false,
          status: 'FAILED',
          attemptedAt: new Date(),
          error: `DELIVERY_UNKNOWN: ${errorMsg}`,
          providerName: isLiveMode ? 'SmtpProvider' : 'MockProvider',
          dryRun: !isLiveMode,
        };
        unknown++;
      }

      results.push(result);

      if (result.success) {
        if (result.status === 'SENT') {
          sent++;
          await this.db.outreach.update({
            where: { id: candidate.outreachId },
            data: {
              status: 'SENT',
              sentAt: new Date(),
              providerMessageId: result.messageId,
              dryRun: false,
            },
          });
        } else {
          simulated++;
          await this.db.outreach.update({
            where: { id: candidate.outreachId },
            data: {
              status: 'READY_TO_SEND',
              dryRun: true,
            },
          });
        }
      } else {
        if (result.error?.includes('DELIVERY_UNKNOWN')) {
          unknown++;
          await this.db.outreach.update({
            where: { id: candidate.outreachId },
            data: {
              status: 'FAILED',
              error: 'DELIVERY_STATUS_UNKNOWN — Manual investigation required',
            },
          });
        } else {
          failed++;
          await this.db.outreach.update({
            where: { id: candidate.outreachId },
            data: {
              status: 'FAILED',
              error: result.error || 'SMTP_DISPATCH_FAILURE',
            },
          });
        }
      }
    }

    const updatedSentToday = await this.validator.getTodaySentCount();
    remainingDailyCapacity = Math.max(0, config.LIVE_PILOT_MAX_SENDS_PER_DAY - updatedSentToday);

    const endTime = new Date();

    return {
      pilotRunId,
      timestamp: new Date(),
      startTime,
      endTime,
      safetyState,
      totalEligible: preview.eligibleCount,
      candidates,
      attempted: results.length,
      sent,
      simulated,
      blocked,
      failed,
      unknown,
      duplicateBlocked,
      remainingDailyCapacity,
      results,
      confirmed: true,
      message: isLiveMode
        ? `Live pilot execution finished: ${sent} emails accepted by SMTP, ${failed} failed, ${blocked} blocked.`
        : `DRY RUN — ZERO REAL MESSAGES SENT: ${simulated} drafts simulated, ${blocked} blocked.`,
    };
  }

  public async getPilotReport(limit: number = 10): Promise<{
    sentToday: number;
    remainingDailyCapacity: number;
    killSwitchActive: boolean;
    safetyState: Record<string, unknown>;
    recentSends: Array<{
      id: string;
      businessName: string;
      recipient: string;
      subject: string;
      sentAt: Date | null;
      status: string;
      providerMessageId?: string;
      dryRun: boolean;
      approvedBy?: string;
    }>;
  }> {
    const sentToday = await this.validator.getTodaySentCount();
    const remainingDailyCapacity = Math.max(0, config.LIVE_PILOT_MAX_SENDS_PER_DAY - sentToday);
    const policy = safetyControls.getPolicy();

    const recent = await this.db.outreach.findMany({
      where: {
        status: { in: ['SENT', 'FAILED', 'READY_TO_SEND'] },
      },
      include: {
        lead: {
          include: {
            business: true,
          },
        },
      },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    });

    return {
      sentToday,
      remainingDailyCapacity,
      killSwitchActive: policy.outreachKillSwitch,
      safetyState: {
        dryRun: policy.isDryRun,
        outreachEnabled: config.OUTREACH_ENABLED,
        livePilotEnabled: config.LIVE_PILOT_ENABLED,
        maxSendsPerRun: config.LIVE_PILOT_MAX_SENDS_PER_RUN,
        maxSendsPerDay: config.LIVE_PILOT_MAX_SENDS_PER_DAY,
        requireApproval: config.LIVE_PILOT_REQUIRE_APPROVAL,
      },
      recentSends: recent.map((r) => ({
        id: r.id,
        businessName: r.lead?.business?.name || 'Unknown Business',
        recipient: r.primaryContactValue || '',
        subject: r.finalSubject || r.subject || 'Website Consultation',
        sentAt: r.sentAt,
        status: r.status,
        providerMessageId: r.providerMessageId || undefined,
        dryRun: r.dryRun,
        approvedBy: r.approvedBy || undefined,
      })),
    };
  }
}

export const pilotExecutionService = new PilotExecutionService();
