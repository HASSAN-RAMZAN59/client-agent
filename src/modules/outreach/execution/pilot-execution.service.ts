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
import { isStrictlyValidEmail, normalizeCountryCode } from '../../../utils/email-validator.js';
import { ContentHasher } from '../../personalization/hardening/content-hasher.js';

export interface PilotExecutionParams {
  limit?: number;
  confirm?: boolean;
  dryRun?: boolean;
  campaignId?: string;
  pilotRunId?: string;
  allowTestRecord?: boolean;
  includeTest?: boolean;
  pilotCountry?: string;
  live?: boolean;
}

export interface PilotCandidateSummary {
  outreachId: string;
  businessName: string;
  city?: string;
  state?: string;
  country?: string;
  niche?: string;
  campaignMatch: string;
  recipientEmail: string;
  emailSyntax: string;
  isVerifiedPublic: boolean;
  exactSourceUrl: string;
  emailAsFound: string;
  sourceContext: string;
  verificationTimestamp?: string;
  businessMatch: string;
  locationMatch: string;
  candidateQuality: string;
  liveSendState: string;
  blockingReason?: string;
  emailClassification: string;
  subject: string;
  leadScore: number;
  leadClass: string;
  salesAngle: string;
  approvalStatus: string;
  eligible: boolean;
  isSuppressed: boolean;
  isCooldownActive: boolean;
  hasHumanApproval: boolean;
  provenanceWarning?: string;
  smtpConfigured: string;
  legalCompliance: string;
  providerPolicy: string;
  technicalReadiness: string;
}

export interface PilotPreviewReport {
  timestamp: Date;
  candidates: PilotCandidateSummary[];
  eligibleCount: number;
  blockedCount: number;
  networkSends: number;
  remainingDailyCapacity: number;
  invalidEmailRejected: number;
  nonUSRejected: number;
  provenanceWarnings: number;
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
    customSmtpProvider?: SmtpDeliveryProvider,
    customMockProvider?: MockOutreachProvider
  ) {
    this.db = customDb || getPrismaClient();
    this.validator = customValidator || new PreSendValidator(this.db);
    this.smtpProvider = customSmtpProvider || new SmtpDeliveryProvider();
    this.mockProvider = customMockProvider || new MockOutreachProvider();
  }

  public async previewPilot(
    limit: number = 3,
    campaignId?: string,
    options?: { includeTest?: boolean; allowTestRecord?: boolean; pilotCountry?: string; dryRun?: boolean }
  ): Promise<PilotPreviewReport> {
    const policy = safetyControls.getPolicy();
    const hardLimit = Math.min(limit, config.LIVE_PILOT_MAX_SENDS_PER_RUN, 3);
    const includeTest = options?.includeTest ?? false;
    const pilotCountry = options?.pilotCountry;

    const where: any = {
      channel: 'EMAIL',
      status: { in: ['DRAFT', 'REVIEW_REQUIRED', 'APPROVED', 'READY_TO_SEND'] },
    };

    if (!includeTest) {
      where.lead = {
        business: {
          NOT: [
            { source: { startsWith: 'test' } },
            { source: 'TEST_SUITE' },
            { name: { startsWith: 'Test' } },
            { name: { startsWith: 'Execution Biz' } },
            { name: { startsWith: 'Contact Test' } },
            { name: { startsWith: 'BatchTest' } },
            { name: { startsWith: 'Phase11' } },
            { name: { startsWith: 'Approved Biz' } },
            { name: { startsWith: 'Cooldown Biz' } },
            { name: { startsWith: 'Suppressed' } },
            { name: { contains: 'Test Biz' } },
            { name: { contains: 'Personalize Test' } },
            { name: { contains: 'Expired Biz' } },
            { name: { contains: 'Suppressed Lead Biz' } },
            { name: { contains: 'Gate Biz' } },
            { name: { contains: 'Duplicate Biz' } },
            { name: { contains: 'Pilot Test' } },
            { name: { contains: 'Mock Biz' } },
            { name: { contains: 'Fixture Biz' } },
            { name: { contains: 'Test Clinic' } },
            { name: { contains: 'Scoring Test' } },
            { name: { contains: 'UnitTest' } },
          ],
        },
      };
    }

    let targetCampaign: any = null;
    if (campaignId) {
      targetCampaign = await this.db.campaign.findUnique({ where: { id: campaignId } });
      where.lead = {
        ...(where.lead || {}),
        business: {
          ...(where.lead?.business || {}),
          OR: [
            { campaignId },
            { campaignBusinesses: { some: { campaignId } } },
          ],
        },
      };
    }

    // Pilot country filter at the Prisma query level supporting common name variants
    if (pilotCountry) {
      const norm = normalizeCountryCode(pilotCountry);
      const variants =
        norm === 'US'
          ? ['US', 'USA', 'United States', 'United States of America', 'U.S.', 'U.S.A.', 'us', 'usa']
          : norm === 'CA'
          ? ['CA', 'CAN', 'Canada', 'ca', 'can']
          : norm === 'GB'
          ? ['GB', 'GBR', 'UK', 'United Kingdom', 'Great Britain', 'gb', 'uk']
          : [pilotCountry, norm];

      where.lead = {
        ...(where.lead || {}),
        business: {
          ...(where.lead?.business || {}),
          country: { in: variants },
        },
      };
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
                campaign: true,
                campaignBusinesses: true,
              },
            },
          },
        },
      },
      take: 200,
      orderBy: { lead: { leadOpportunityScore: 'desc' } },
    });

    const candidates: PilotCandidateSummary[] = [];
    const seenLeads = new Set<string>();
    let eligibleCount = 0;
    let blockedCount = 0;
    let invalidEmailRejected = 0;
    let nonUSRejected = 0;
    let provenanceWarnings = 0;

    for (const o of outreaches) {
      if (seenLeads.has(o.leadId)) continue;
      if (candidates.length >= hardLimit) break;
      seenLeads.add(o.leadId);
      const b = o.lead?.business;
      const l = o.lead;
      const matchingContact = b?.contacts?.find((c) => c.type === 'EMAIL');
      const recipient = o.primaryContactValue || matchingContact?.value || '';

      // Strict email validation — skip invalid emails entirely
      const emailCheck = isStrictlyValidEmail(recipient);
      if (!emailCheck.valid) {
        invalidEmailRejected++;
        this.log.warn(`[pilot-preview] Skipping invalid email contact: ${recipient} (${emailCheck.reason})`);
        continue;
      }

      // Country check at candidate level (safety net for query-level filter)
      if (pilotCountry) {
        const target = normalizeCountryCode(pilotCountry);
        const biz = normalizeCountryCode(b?.country);
        if (biz && biz !== target) {
          nonUSRejected++;
          continue;
        }
      }

      // Provenance warning check
      let provenanceWarning: string | undefined;
      if (matchingContact) {
        if (!matchingContact.sourceUrl || matchingContact.status !== 'VERIFIED_PUBLIC') {
          provenanceWarning = 'EMAIL_SOURCE_NOT_VERIFIABLE';
          provenanceWarnings++;
        }
      } else {
        provenanceWarning = 'NO_MATCHING_CONTACT_RECORD';
        provenanceWarnings++;
      }

      let salesAngleText = 'Website improvement opportunity';
      if (l?.salesAngle) {
        try {
          const parsed = JSON.parse(l.salesAngle);
          salesAngleText = parsed.problem || parsed.opportunity || parsed.reason || l.salesAngle;
        } catch {
          salesAngleText = l.salesAngle;
        }
      }

      const isDryRunPreview = options?.dryRun ?? false;
      const eligibility = await this.validator.isLivePilotEligible(o.id, {
        checkEnvFlags: !isDryRunPreview,
        dryRun: isDryRunPreview,
        campaignId,
        pilotCountry,
        campaignCity: targetCampaign?.city,
        campaignCountry: targetCampaign?.country,
        campaignNiche: targetCampaign?.niche,
        allowTestRecord: options?.allowTestRecord ?? (process.env.NODE_ENV === 'test'),
        requireStrictProvenance: true,
        provider: this.smtpProvider,
      });

      // Determine separate quality vs send state
      const qualityReasons = eligibility.reasons.filter(
        (r) =>
          ![
            'KILL_SWITCH_ACTIVE',
            'PILOT_DISABLED',
            'OUTREACH_DISABLED',
            'DRY_RUN_ACTIVE',
            'DAILY_LIMIT_REACHED',
            'NOT_HUMAN_APPROVED',
            'HUMAN_APPROVAL_REQUIRED',
            'OUTBOUND_PROVIDER_POLICY_UNSUPPORTED',
            'PROVIDER_POLICY_REVIEW_REQUIRED',
          ].includes(r)
      );
      const candidateQuality = qualityReasons.length === 0 ? 'VALID' : 'INVALID';

      // Provider Policy & Technical Readiness Evaluation
      const smtpConfigured = Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASSWORD) ? 'YES' : 'NO';
      const legalCompliance = eligibility.details.legalComplianceValid !== false ? 'READY' : 'NON_COMPLIANT';
      const providerPolicyResult = typeof this.smtpProvider?.getProviderPolicyStatus === 'function'
        ? this.smtpProvider.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' })
        : { status: 'PERMITTED' as const };
      const providerPolicy = providerPolicyResult.status === 'PERMITTED' ? 'PERMITTED' : 'BLOCKED';
      const technicalReadiness =
        candidateQuality === 'VALID' && smtpConfigured === 'YES' && legalCompliance === 'READY'
          ? 'TECHNICALLY READY'
          : 'INCOMPLETE';

      // Check live env flags and provider policy for send state
      const envBlockers: string[] = [];
      if (!config.LIVE_PILOT_ENABLED) envBlockers.push('PILOT_DISABLED');
      if (!config.OUTREACH_ENABLED) envBlockers.push('OUTREACH_DISABLED');
      if (config.DRY_RUN) envBlockers.push('DRY_RUN_ACTIVE');
      if (safetyControls.isKillSwitchActive()) envBlockers.push('KILL_SWITCH_ACTIVE');
      if (providerPolicy === 'BLOCKED') envBlockers.push(providerPolicyResult.reasonCode || 'OUTBOUND_PROVIDER_POLICY_UNSUPPORTED');

      const liveSendState = envBlockers.length === 0 ? 'ENABLED' : 'BLOCKED';

      const isCandidateEligible = isDryRunPreview
        ? eligibility.eligible
        : eligibility.eligible && providerPolicy === 'PERMITTED';

      if (isCandidateEligible) {
        eligibleCount++;
      } else {
        blockedCount++;
      }

      let blockingReasonText = eligibility.reasons.length > 0 ? eligibility.reasons.join(', ') : undefined;
      if (!isDryRunPreview && providerPolicy === 'BLOCKED') {
        const policyReason = providerPolicyResult.reasonCode || 'OUTBOUND_PROVIDER_POLICY_UNSUPPORTED';
        if (!blockingReasonText) {
          blockingReasonText = policyReason;
        } else if (!blockingReasonText.includes(policyReason)) {
          blockingReasonText = `${blockingReasonText}, ${policyReason}`;
        }
      }

      const targetCountryNorm = normalizeCountryCode(pilotCountry || targetCampaign?.country || 'US');
      const bizCountryNorm = normalizeCountryCode(b?.country);
      const targetCityNorm = (targetCampaign?.city || 'Dallas').toLowerCase().trim();
      const bizCityNorm = (b?.city || '').toLowerCase().trim();
      const locMatch = bizCountryNorm === targetCountryNorm && (!targetCampaign?.city || bizCityNorm === targetCityNorm);
      const nicheMatch = !targetCampaign?.niche || this.validator.isNicheMatch(b?.category || '', targetCampaign.niche);
      const campMatch = locMatch && nicheMatch;
      const bizMatch = Boolean(b?.name && b.name.trim().length >= 2 && !b.name.toLowerCase().includes('unknown'));

      candidates.push({
        outreachId: o.id,
        businessName: b?.name || 'Unknown Business',
        city: b?.city || undefined,
        state: (b as any)?.state || 'TX',
        country: b?.country || undefined,
        niche: b?.category || undefined,
        campaignMatch: campMatch ? 'MATCH' : 'MISMATCH',
        recipientEmail: recipient,
        emailSyntax: emailCheck.valid ? 'VALID' : 'INVALID',
        isVerifiedPublic: matchingContact?.status === 'VERIFIED_PUBLIC',
        exactSourceUrl: matchingContact?.sourceUrl || 'NONE',
        emailAsFound: (matchingContact as any)?.emailAsFound || matchingContact?.value || 'NONE',
        sourceContext: (matchingContact as any)?.sourceContext || 'NONE',
        verificationTimestamp: matchingContact?.discoveredAt?.toISOString() || matchingContact?.createdAt?.toISOString() || 'NONE',
        businessMatch: bizMatch ? 'MATCH' : 'MISMATCH',
        locationMatch: locMatch ? 'MATCH' : 'MISMATCH',
        emailClassification: matchingContact?.classification || 'BUSINESS_GENERIC',
        subject: o.finalSubject || o.subject || 'Website Consultation',
        leadScore: l?.leadOpportunityScore || 0,
        leadClass: l?.classification || 'WARM',
        salesAngle: salesAngleText,
        approvalStatus: o.approvalStatus || (o.approvedAt ? 'APPROVED' : 'REVIEW_REQUIRED'),
        eligible: isCandidateEligible,
        blockingReason: blockingReasonText,
        isSuppressed: eligibility.details.isSuppressed,
        isCooldownActive: eligibility.details.isCooldownActive,
        hasHumanApproval: eligibility.details.hasHumanApproval,
        candidateQuality,
        liveSendState,
        provenanceWarning,
        smtpConfigured,
        legalCompliance,
        providerPolicy,
        technicalReadiness,
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
      invalidEmailRejected,
      nonUSRejected,
      provenanceWarnings,
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

    const isExplicitDryRun = Boolean(params.dryRun);
    const effectiveDryRun = isExplicitDryRun && (Boolean(params.dryRun) || policy.isDryRun);
    const isLiveMode =
      !effectiveDryRun &&
      config.OUTREACH_ENABLED &&
      config.LIVE_PILOT_ENABLED &&
      !policy.outreachKillSwitch;

    // Enforce hard server-side limits:
    // For FIRST REAL PILOT, server-side guard strictly caps live sends to exactly 1
    // Even if CLI requests --limit 2, --limit 3, --limit 100
    const maxAllowedLimit = isLiveMode ? 1 : 3;
    const effectiveLimit = Math.min(
      params.limit || (isLiveMode ? 1 : config.LIVE_PILOT_MAX_SENDS_PER_RUN),
      isLiveMode ? 1 : config.LIVE_PILOT_MAX_SENDS_PER_RUN,
      maxAllowedLimit
    );

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

    // 1. Defense-in-depth provider check for dry-run simulation
    if (effectiveDryRun) {
      const isSafeMock =
        this.mockProvider instanceof MockOutreachProvider ||
        (this.mockProvider as any).isNetworkTransport === false;
      const isRealTransport =
        this.mockProvider instanceof SmtpDeliveryProvider ||
        (this.mockProvider as any).isNetworkTransport === true ||
        (this.mockProvider as any).name === 'SmtpDeliveryProvider';

      if (!isSafeMock || isRealTransport) {
        this.log.error('Dry-run simulation rejected: real network transport detected for dry-run.');
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
          message: 'DRY_RUN_REAL_TRANSPORT_PROHIBITED: Real transport provider cannot be used for dry-run simulation.',
        };
      }
    } else {
      // 1b. LIVE MODE: Kill switch is a HARD BLOCK
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
    }

    const preview = await this.previewPilot(effectiveLimit, params.campaignId, {
      allowTestRecord: params.allowTestRecord ?? (process.env.NODE_ENV === 'test'),
      includeTest: params.includeTest ?? params.allowTestRecord ?? false,
      pilotCountry: params.pilotCountry,
      dryRun: effectiveDryRun,
    });
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

    // 2b. Live send safety check (live mode requires OUTREACH_ENABLED=true and LIVE_PILOT_ENABLED=true and DRY_RUN=false)
    if (!effectiveDryRun && !isLiveMode) {
      this.log.warn('Live execution blocked: LIVE PILOT DISABLED OR DRY RUN ACTIVE');
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
        message: 'LIVE PILOT BLOCKED: Live outreach is disabled (OUTREACH_ENABLED=false or LIVE_PILOT_ENABLED=false or DRY_RUN=true).',
      };
    }

    // 2c. Explicit --live confirmation flag required for live SMTP dispatch
    if (isLiveMode && !params.live) {
      this.log.warn('Live execution blocked: Reason: explicit --live flag required for live SMTP transmission.');
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
        message: 'LIVE_FLAG_REQUIRED: Explicit --live flag required for live SMTP transmission.',
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

    // 4. Outbound Provider Policy Gate (Requirement 2, 4, 5)
    if (isLiveMode) {
      const providerPolicy = typeof this.smtpProvider?.getProviderPolicyStatus === 'function'
        ? this.smtpProvider.getProviderPolicyStatus({ outreachType: 'COLD_COMMERCIAL' })
        : { status: 'PERMITTED' as const };
      if (providerPolicy.status !== 'PERMITTED') {
        const reasonCode = providerPolicy.reasonCode || 'OUTBOUND_PROVIDER_POLICY_UNSUPPORTED';
        this.log.warn(`Live execution blocked by provider policy: ${reasonCode}`);
        return {
          pilotRunId,
          timestamp: new Date(),
          startTime,
          endTime: new Date(),
          safetyState,
          totalEligible: 0,
          candidates,
          attempted: 0,
          sent: 0,
          simulated: 0,
          blocked: candidates.length,
          failed: 0,
          unknown: 0,
          duplicateBlocked: 0,
          remainingDailyCapacity,
          results: candidates.map((c) => ({
            success: false,
            status: 'FAILED' as const,
            attemptedAt: new Date(),
            error: reasonCode,
            providerName: this.smtpProvider.name,
            dryRun: false,
          })),
          confirmed: Boolean(params.confirm),
          message: `LIVE PILOT BLOCKED BY PROVIDER POLICY: ${reasonCode} — Personal Gmail (@gmail.com) SMTP cannot be used for unsolicited cold commercial outreach.`,
        };
      }
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

      // Immediate pre-send atomic check (live mode only)
      if (isLiveMode && safetyControls.isKillSwitchActive()) {
        blocked++;
        results.push({
          success: false,
          status: 'FAILED',
          attemptedAt: new Date(),
          error: 'KILL_SWITCH_TRIGGERED_DURING_RUN',
          providerName: 'SafetyGuard',
          dryRun: false,
        });
        break;
      }

      const eligibility = await this.validator.isLivePilotEligible(candidate.outreachId, {
        checkEnvFlags: !effectiveDryRun,
        dryRun: effectiveDryRun,
        campaignId: params.campaignId,
        pilotCountry: params.pilotCountry,
        allowTestRecord: params.allowTestRecord ?? (process.env.NODE_ENV === 'test'),
        requireStrictProvenance: true,
        provider: this.smtpProvider,
      });

      if (!eligibility.eligible) {
        blocked++;
        results.push({
          success: false,
          status: 'FAILED',
          attemptedAt: new Date(),
          error: eligibility.reasons.join(', '),
          providerName: 'PreSendValidator',
          dryRun: effectiveDryRun,
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

      // Snapshot Integrity Guard: Verify approved content has not mutated
      if (outreachRecord.contentHash) {
        const checkSubject = outreachRecord.finalSubject || outreachRecord.subject || '';
        const checkBody = outreachRecord.finalBody || outreachRecord.body || '';
        const checkHash = ContentHasher.hashDraft(checkSubject, checkBody);
        if (checkHash !== outreachRecord.contentHash) {
          blocked++;
          results.push({
            success: false,
            status: 'FAILED',
            attemptedAt: new Date(),
            error: 'CONTENT_CHANGED_AFTER_APPROVAL',
            providerName: 'ContentIntegrityGuard',
            dryRun: !isLiveMode,
          });
          continue;
        }
      }

      // Mark status as SENDING ONLY in live mode
      if (isLiveMode) {
        await this.db.outreach.update({
          where: { id: candidate.outreachId },
          data: { status: 'SENDING', attemptedAt: new Date() },
        });
      }

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
          // Double-check provider safety
          if (
            this.mockProvider.name !== 'MockOutreachProvider' ||
            (this.mockProvider as any).isNetworkTransport === true ||
            this.mockProvider instanceof SmtpDeliveryProvider
          ) {
            throw new Error('DRY_RUN_REAL_TRANSPORT_PROHIBITED');
          }
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

      // In live mode, first pilot strictly halts after 1 send attempt (success or failure)
      // Guarantees zero automatic fallback to candidate #2 and zero automatic retries
      if (isLiveMode) {
        this.log.info(`[FIRST LIVE PILOT] Single dispatch completed (Result: ${result.status}). Halting execution.`);
        break;
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
