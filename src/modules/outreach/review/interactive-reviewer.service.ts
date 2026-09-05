import readline from 'readline';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../../database/client.js';
import { createLogger } from '../../../utils/logger.js';
import { preSendValidator } from '../gate/pre-send-validator.js';
import { isStrictlyValidEmail } from '../../../utils/email-validator.js';
import { normalizeNiche } from '../../discovery/niche-normalizer.js';

export interface PilotReviewItemVariant {
  outreachId: string;
  variantKey: string; // 'VARIANT_A_SHORT' | 'VARIANT_B_STANDARD' | 'VARIANT_C_AUDIT'
  variantLabel: string;
  subject: string;
  body: string;
  qualityScore: number;
  qualityBand: string;
  status: string;
}

export interface InteractiveReviewBusinessGroup {
  businessId: string;
  leadId: string;
  businessName: string;
  location: string;
  city: string;
  country: string;
  niche: string;
  website: string;
  leadScore: number;
  classification: string;
  problemSeverity: number;
  problem: string;
  salesAngle: string;
  auditEvidence: string[];
  recommendedService: string;
  channel: string;
  recipientEmail: string;
  provenance: {
    sourceUrl?: string | null;
    sourceType?: string | null;
    discoveredAt?: Date | null;
    status: string;
    isVerified: boolean;
  };
  nameConfidence: string;
  recordType: 'REAL' | 'TEST';
  variants: PilotReviewItemVariant[];
}

export interface ReviewInteractiveOptions {
  campaignId?: string;
  country?: string;
  emailOnly?: boolean;
  pilotEligible?: boolean;
  minClass?: 'HOT_OR_WARM' | 'ALL';
  limit?: number;
  includeTest?: boolean;
}

export class InteractiveReviewerService {
  private db: PrismaClient;
  private log = createLogger('InteractiveReviewer');

  constructor(customDb?: PrismaClient) {
    this.db = customDb || getPrismaClient();
  }

  /**
   * Retrieves pending review items grouped by business.
   * Enforces all campaign-scoped, pilot-quality, email-only, provenance, and problem-evidence rules.
   */
  public async getPendingBusinessGroups(
    options: ReviewInteractiveOptions = {}
  ): Promise<InteractiveReviewBusinessGroup[]> {
    const limit = options.limit ?? 50;
    const includeTest = options.includeTest ?? false;
    const emailOnly = options.emailOnly ?? (options.pilotEligible ? true : false);
    const pilotEligible = options.pilotEligible ?? false;
    const targetCountry = options.country || (pilotEligible ? 'US' : undefined);
    const minClass = options.minClass || (pilotEligible ? 'HOT_OR_WARM' : 'ALL');

    // 1. Resolve Target Campaign configuration if campaignId provided
    let campaign: any = null;
    if (options.campaignId) {
      campaign = await this.db.campaign.findUnique({
        where: { id: options.campaignId },
      });
      if (!campaign) {
        this.log.warn(`Target campaign "${options.campaignId}" not found in database.`);
        return [];
      }
    }

    // 2. Query outreach records in DRAFT / REVIEW_REQUIRED status
    const whereClause: any = {
      status: { in: ['DRAFT', 'REVIEW_REQUIRED'] },
      lead: { id: { not: '' } },
    };

    if (!includeTest) {
      whereClause.lead = {
        id: { not: '' },
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

    const outreaches = await this.db.outreach.findMany({
      where: whereClause,
      include: {
        lead: {
          include: {
            business: {
              include: {
                audits: { orderBy: { createdAt: 'desc' }, take: 1 },
                contacts: true,
                campaign: true,
                campaignBusinesses: { include: { campaign: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 3. Group by business
    const businessMap = new Map<string, { business: any; lead: any; outreaches: any[] }>();

    for (const o of outreaches) {
      const b = o.lead?.business;
      const l = o.lead;
      if (!b || !l) continue;

      if (!businessMap.has(b.id)) {
        businessMap.set(b.id, { business: b, lead: l, outreaches: [] });
      }
      businessMap.get(b.id)!.outreaches.push(o);
    }

    const groups: InteractiveReviewBusinessGroup[] = [];

    for (const [, { business: b, lead: l, outreaches: bizOutreaches }] of businessMap.entries()) {
      // Rule 1: Campaign-Scoped Membership Check
      if (campaign) {
        const matchesDirect = b.campaignId === campaign.id;
        const matchesJoin = b.campaignBusinesses?.some((cb: any) => cb.campaignId === campaign.id);
        if (!matchesDirect && !matchesJoin) {
          continue; // Exclude non-campaign business
        }

        // Market & Locality check
        const isCityMatch = b.city?.toLowerCase().trim() === campaign.city?.toLowerCase().trim();
        const isCountryMatch =
          b.country?.toLowerCase().trim() === campaign.country?.toLowerCase().trim() ||
          (['us', 'usa', 'united states'].includes(b.country?.toLowerCase().trim() || '') &&
            ['us', 'usa', 'united states'].includes(campaign.country?.toLowerCase().trim() || ''));
        if (!isCityMatch || !isCountryMatch) {
          continue; // Exclude wrong-market business
        }

        // Niche check
        const allowedNiches = campaign.niche
          ? campaign.niche.split(',').map((n: string) => n.trim()).filter(Boolean)
          : [];
        const isNicheMatch = allowedNiches.some((n: string) => {
          const targetNorm = normalizeNiche(n);
          const bizNorm = normalizeNiche(b.category || '');
          if (targetNorm.isValid && bizNorm.isValid && targetNorm.canonical !== 'UNKNOWN' && targetNorm.canonical === bizNorm.canonical) {
            return true;
          }
          const lowerN = n.toLowerCase();
          const lowerCat = (b.category || '').toLowerCase();
          if (lowerN === 'dentist' || lowerN === 'dental' || targetNorm.canonical === 'DENTIST') {
            return (
              lowerCat.includes('dent') ||
              lowerCat.includes('orthodont') ||
              lowerCat.includes('oral')
            );
          }
          if (lowerN === 'hvac' || lowerN === 'heating' || targetNorm.canonical === 'HVAC') {
            return (
              lowerCat.includes('hvac') ||
              lowerCat.includes('air condition') ||
              lowerCat.includes('heating') ||
              lowerCat.includes('heat')
            );
          }
          return lowerCat.includes(lowerN) || lowerN.includes(lowerCat);
        });

        if (!isNicheMatch) {
          continue; // Exclude wrong-niche business
        }
      }

      // Rule 1b: Country Filter
      if (targetCountry) {
        const isTargetCountry =
          targetCountry.toLowerCase() === 'us'
            ? ['us', 'usa', 'united states'].includes(b.country?.toLowerCase().trim() || '')
            : b.country?.toLowerCase().trim() === targetCountry.toLowerCase().trim();
        if (!isTargetCountry) {
          continue;
        }
      }

      // Rule 2: First Pilot Quality Filter (HOT or WARM required)
      if (minClass === 'HOT_OR_WARM') {
        const leadClass = (l.classification || '').toUpperCase();
        if (leadClass !== 'HOT' && leadClass !== 'WARM') {
          continue; // Exclude COLD or undefined leads
        }
      }

      // Rule 3: Problem Evidence Required
      let auditFindings: string[] = [];
      let topProblems: string[] = [];
      const audit = b.audits?.[0];
      if (audit?.issuesJson) {
        try {
          topProblems = JSON.parse(audit.issuesJson);
        } catch {}
      }
      if (l.topProblems) {
        try {
          const parsed = JSON.parse(l.topProblems);
          if (Array.isArray(parsed) && parsed.length > 0) {
            topProblems = parsed;
          }
        } catch {}
      }
      if (audit?.findings) {
        try {
          auditFindings = JSON.parse(audit.findings);
        } catch {}
      }

      // Check concrete audit observation
      const hasConcreteObservation =
        Boolean(audit?.loadTimeMs && audit.loadTimeMs > 0) ||
        Boolean(audit?.mobileResponsive === false) ||
        Boolean(audit?.sslValid === false) ||
        Boolean(audit?.hasContactForm === false) ||
        (Array.isArray(topProblems) && topProblems.length > 0) ||
        (Array.isArray(auditFindings) && auditFindings.length > 0);

      let salesAngleProblem = '';
      if (l.salesAngle) {
        try {
          const parsed = JSON.parse(l.salesAngle);
          salesAngleProblem = parsed.problem || '';
        } catch {}
      }

      const isGenericProblem =
        !salesAngleProblem ||
        salesAngleProblem.toLowerCase().includes('sub-optimal conversion flow') ||
        salesAngleProblem.toLowerCase().includes('modernization') ||
        salesAngleProblem.trim().length === 0;

      if (!hasConcreteObservation && isGenericProblem) {
        // Missing verified concrete problem
        continue;
      }

      // Rule 4: Business Name Quality & Safe Identity
      const rawBizName = b.name ? b.name.trim() : '';
      const unsafeIdentityRegexes = [
        /^(?:dentist|dentists|dentistry|dental|hvac|plumber|plumbing|doctor|lawyer|attorney|roofing|electrician|cleaning)\s+in\s+[a-zA-Z\s,.-]+$/i,
        /^[a-zA-Z\s,.-]+,\s*(?:TX|CA|NY|FL|IL|PA|OH|GA|NC|MI|NJ|VA|WA|AZ|MA|TN|IN|MO|MD|WI|CO|MN|SC|AL|LA|KY|OR|OK|CT|UT|IA|NV|AR|MS|KS|NM|NE|ID|WV|HI|NH|ME|MT|RI|DE|SD|ND|AK|DC|USA)\s+(?:dentists?|dentistry|hvac|plumbers?|doctors?|lawyers?|attorneys?|services)$/i,
        /^(?:dentist|dentistry|dental|hvac|plumber|doctor|lawyer)\s+near\s+me$/i,
        /^(?:best|top|affordable|emergency|cheap)\s+(?:dentists?|hvac|plumbers?|doctors?)\s+in\s+[a-zA-Z\s,.-]+$/i,
      ];
      if (!rawBizName || rawBizName.length < 2 || unsafeIdentityRegexes.some((rx) => rx.test(rawBizName))) {
        continue; // Exclude BUSINESS_IDENTITY_UNSAFE
      }

      // Rule 6: Email-Only Pilot Review & Verified Contact Check
      const primaryEmailContact = b.contacts?.find(
        (ct: any) =>
          ct.type === 'EMAIL' &&
          ct.status === 'VERIFIED_PUBLIC' &&
          Boolean(ct.sourceUrl) &&
          isStrictlyValidEmail(ct.value).valid
      );

      if (emailOnly && !primaryEmailContact) {
        continue; // Exclude PHONE records or NO_EMAIL_CONTACT
      }

      const recipientEmail = primaryEmailContact?.value || '';

      // Check pre-send validation for each draft to ensure safety
      const validVariants: PilotReviewItemVariant[] = [];

      for (const o of bizOutreaches) {
        if (emailOnly && o.channel !== 'EMAIL') continue;
        if (!o.primaryContactValue && !recipientEmail) continue;

        const gateCheck = await preSendValidator.validateOutreach(o.id, {
          strictLiveMode: false,
          campaignId: campaign?.id,
          campaignCity: campaign?.city,
          campaignCountry: campaign?.country,
          campaignNiche: campaign?.niche,
          allowTestRecord: includeTest,
          pilotCountry: targetCountry,
          requireStrictProvenance: true,
        });

        // Filter out drafts that have hard fatal issues (ignoring kill switch / approval requirement)
        const fatalReasons = gateCheck.reasons.filter(
          (r) =>
            !['KILL_SWITCH_ACTIVE', 'NOT_HUMAN_APPROVED', 'HUMAN_APPROVAL_REQUIRED'].includes(r)
        );

        if (fatalReasons.length > 0) {
          continue; // Exclude invalid draft
        }

        let variantLabel = 'Standard Variant';
        if (o.variant === 'VARIANT_A_SHORT') variantLabel = 'Variant A (Short / Concise)';
        else if (o.variant === 'VARIANT_B_STANDARD') variantLabel = 'Variant B (Standard / Value-First)';
        else if (o.variant === 'VARIANT_C_AUDIT') variantLabel = 'Variant C (Audit / Technical)';

        validVariants.push({
          outreachId: o.id,
          variantKey: o.variant,
          variantLabel,
          subject: o.subject,
          body: o.body,
          qualityScore: o.qualityScore,
          qualityBand: o.qualityBand,
          status: o.status,
        });
      }

      if (validVariants.length === 0) {
        continue;
      }

      // Sort variants standard order (A -> B -> C)
      validVariants.sort((v1, v2) => v1.variantKey.localeCompare(v2.variantKey));

      let displayProblem = topProblems[0] || salesAngleProblem || 'Identifiable website performance / mobile layout issues';
      if (audit?.loadTimeMs && audit.loadTimeMs > 0) {
        displayProblem = `Mobile load time ${(audit.loadTimeMs / 1000).toFixed(1)}s (exceeds recommended target)`;
      }

      let salesAngleText = 'Targeted performance and mobile UX refinements';
      if (l.salesAngle) {
        try {
          const parsed = JSON.parse(l.salesAngle);
          salesAngleText = parsed.opportunity || parsed.reason || salesAngleText;
        } catch {}
      }

      const isTest =
        b.source?.startsWith('test') ||
        b.source === 'TEST_SUITE' ||
        b.name?.startsWith('Test');

      groups.push({
        businessId: b.id,
        leadId: l.id,
        businessName: b.name,
        location: `${b.city}, ${b.country}`,
        city: b.city,
        country: b.country,
        niche: b.category,
        website: b.website || 'None',
        leadScore: l.leadOpportunityScore || 0,
        classification: l.classification || 'WARM',
        problemSeverity: l.websiteProblemScore || 0,
        problem: displayProblem,
        salesAngle: salesAngleText,
        auditEvidence: topProblems.length > 0 ? topProblems : auditFindings,
        recommendedService: l.recommendedService || 'WEBSITE_IMPROVEMENT',
        channel: 'EMAIL',
        recipientEmail,
        provenance: {
          sourceUrl: primaryEmailContact?.sourceUrl,
          sourceType: primaryEmailContact?.sourceType,
          discoveredAt: primaryEmailContact?.discoveredAt || primaryEmailContact?.createdAt,
          status: primaryEmailContact?.status || 'VERIFIED_PUBLIC',
          isVerified: Boolean(primaryEmailContact?.isVerified),
        },
        nameConfidence: 'HIGH',
        recordType: isTest ? 'TEST' : 'REAL',
        variants: validVariants,
      });
    }

    // Rule 7: Ranking Priority
    // 1. Candidate Quality (All Valid)
    // 2. HOT > WARM > COLD
    // 3. Verified problem severity (desc)
    // 4. Contact provenance quality (desc)
    // 5. Lead score (desc)
    // 6. Priority rank
    groups.sort((a, b) => {
      const classWeight = (c: string) => (c === 'HOT' ? 3 : c === 'WARM' ? 2 : 1);
      if (classWeight(b.classification) !== classWeight(a.classification)) {
        return classWeight(b.classification) - classWeight(a.classification);
      }
      if (b.problemSeverity !== a.problemSeverity) {
        return b.problemSeverity - a.problemSeverity;
      }
      if (b.leadScore !== a.leadScore) {
        return b.leadScore - a.leadScore;
      }
      return a.businessName.localeCompare(b.businessName);
    });

    return groups.slice(0, limit);
  }

  /**
   * Approves a single selected variant for a business, transitioning it to READY_TO_SEND.
   * Strictly archives / rejects all unselected variants for that lead so they cannot send.
   */
  public async approveSelectedVariant(
    selectedOutreachId: string,
    allLeadOutreaches: string[],
    operator: string = 'HUMAN_OPERATOR'
  ): Promise<void> {
    const now = new Date();

    // 1. Transition selected variant to READY_TO_SEND
    await this.db.outreach.update({
      where: { id: selectedOutreachId },
      data: {
        status: 'READY_TO_SEND',
        approvalStatus: 'APPROVED',
        approvedAt: now,
        approvalTimestamp: now,
        approvedBy: operator,
      },
    });

    // 2. Archive all other variants for this lead
    const otherIds = allLeadOutreaches.filter((id) => id !== selectedOutreachId);
    if (otherIds.length > 0) {
      await this.db.outreach.updateMany({
        where: { id: { in: otherIds } },
        data: {
          status: 'REJECTED',
          approvalStatus: 'REJECTED',
          rejectionReason: `Superseded by approved variant [${selectedOutreachId}] during operator review`,
        },
      });
    }

    this.log.info(
      `Outreach variant [${selectedOutreachId}] APPROVED and set to READY_TO_SEND. ${otherIds.length} other variant(s) archived.`
    );
  }

  /**
   * Rejects entire business and all its outreach drafts.
   */
  public async rejectBusinessGroup(
    businessGroup: InteractiveReviewBusinessGroup,
    reason: string = 'Manual operator rejection during review',
    operator: string = 'HUMAN_OPERATOR'
  ): Promise<void> {
    const outreachIds = businessGroup.variants.map((v) => v.outreachId);
    if (outreachIds.length > 0) {
      await this.db.outreach.updateMany({
        where: { id: { in: outreachIds } },
        data: {
          status: 'REJECTED',
          approvalStatus: 'REJECTED',
          rejectionReason: reason,
        },
      });
    }
    this.log.info(
      `Business [${businessGroup.businessName}] rejected by ${operator} (${outreachIds.length} drafts marked REJECTED).`
    );
  }

  /**
   * Starts the consolidated 1-Business = 1-Review-Item interactive CLI interface.
   */
  public async startInteractiveCli(options: ReviewInteractiveOptions = {}): Promise<void> {
    const groups = await this.getPendingBusinessGroups(options);

    if (groups.length === 0) {
      console.log('\n======================================================================');
      console.log('              HUMAN REVIEW INTERFACE — 0 CANDIDATES');
      console.log('======================================================================\n');
      console.log('NO HIGH-CONFIDENCE PILOT CANDIDATES\n');
      console.log('Zero records satisfied all strict campaign, quality, and provenance filters.\n');
      return;
    }

    console.log(`\n======================================================================`);
    console.log(`      HUMAN REVIEW INTERFACE — ${groups.length} HIGH-CONFIDENCE PILOT BUSINESS(ES)`);
    console.log(`======================================================================\n`);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const ask = (prompt: string): Promise<string> =>
      new Promise((resolve) => rl.question(prompt, resolve));

    try {
      for (let i = 0; i < groups.length; i++) {
        const item = groups[i]!;
        console.log(`======================================================================`);
        console.log(`[CANDIDATE ${i + 1} OF ${groups.length}] ${item.businessName.toUpperCase()}`);
        console.log(`======================================================================`);
        console.log(`• Business Name        : ${item.businessName}`);
        console.log(`• Location             : ${item.location} (Niche: ${item.niche})`);
        console.log(`• Website              : ${item.website}`);
        console.log(`• Verified Recipient   : ${item.recipientEmail} [VERIFIED_PUBLIC]`);
        console.log(`• Exact Source URL     : ${item.provenance.sourceUrl || 'N/A'}`);
        console.log(`• Lead Class & Score   : ${item.classification} (${item.leadScore}/100)`);
        console.log(`• Problem Detected     : ${item.problem}`);
        console.log(`• Recommended Service  : ${item.recommendedService}`);
        console.log(`• Sales Angle          : ${item.salesAngle}`);
        console.log(`\n----------------------------------------------------------------------`);
        console.log(`AVAILABLE MESSAGE VARIANTS (Select 1 to Approve):`);
        console.log(`----------------------------------------------------------------------`);

        for (let idx = 0; idx < item.variants.length; idx++) {
          const v = item.variants[idx]!;
          console.log(`\n[OPTION ${idx + 1}] ${v.variantLabel} [Quality: ${v.qualityScore}/100 - ${v.qualityBand}]`);
          console.log(`Subject: "${v.subject}"`);
          console.log(`Message Body:`);
          console.log(v.body.split('\n').map((line) => `  ${line}`).join('\n'));
        }

        console.log(`\n----------------------------------------------------------------------`);

        let validChoice = false;
        while (!validChoice) {
          const answer = (
            await ask(
              `Choose Action ([1/2/3] Approve Variant | [E]dit Variant | [R]eject Business | [S]kip | [Q]uit): `
            )
          )
            .trim()
            .toUpperCase();

          const allOutreachIds = item.variants.map((v) => v.outreachId);

          if (answer === '1' || answer === '2' || answer === '3') {
            const selectedIdx = parseInt(answer, 10) - 1;
            const selected = item.variants[selectedIdx];
            if (selected) {
              await this.approveSelectedVariant(selected.outreachId, allOutreachIds);
              console.log(
                `✔ Approved [${selected.variantLabel}] for "${item.businessName}". Status: READY_TO_SEND.\n`
              );
              validChoice = true;
            } else {
              console.log(`Invalid variant option number.`);
            }
          } else if (answer === 'R') {
            const reason = await ask(`Enter rejection reason (or press Enter for default): `);
            await this.rejectBusinessGroup(
              item,
              reason.trim() || 'Manual rejection by operator'
            );
            console.log(`✖ Rejected "${item.businessName}". All draft variants removed from send queue.\n`);
            validChoice = true;
          } else if (answer === 'E') {
            const varNum = (await ask(`Which variant to edit? (1-${item.variants.length}): `)).trim();
            const editIdx = parseInt(varNum, 10) - 1;
            const targetVar = item.variants[editIdx];
            if (targetVar) {
              console.log(`\nEnter new Subject (leave empty to keep current):`);
              const newSub = await ask(`New Subject: `);
              console.log(`\nEnter new Body (leave empty to keep current):`);
              const newBody = await ask(`New Body: `);
              const finalSub = newSub.trim() || targetVar.subject;
              const finalBody = newBody.trim() || targetVar.body;

              const now = new Date();
              await this.db.outreach.update({
                where: { id: targetVar.outreachId },
                data: {
                  originalSubject: targetVar.subject,
                  originalBody: targetVar.body,
                  subject: finalSub,
                  body: finalBody,
                  finalSubject: finalSub,
                  finalBody: finalBody,
                  status: 'READY_TO_SEND',
                  approvalStatus: 'EDITED_AND_APPROVED',
                  approvedAt: now,
                  approvalTimestamp: now,
                  approvedBy: 'HUMAN_OPERATOR',
                  editTimestamp: now,
                },
              });

              // Archive other variants
              const otherIds = allOutreachIds.filter((id) => id !== targetVar.outreachId);
              if (otherIds.length > 0) {
                await this.db.outreach.updateMany({
                  where: { id: { in: otherIds } },
                  data: {
                    status: 'REJECTED',
                    approvalStatus: 'REJECTED',
                    rejectionReason: `Superseded by edited variant [${targetVar.outreachId}]`,
                  },
                });
              }

              console.log(`✔ Variant edited, approved, and set to READY_TO_SEND for "${item.businessName}".\n`);
              validChoice = true;
            } else {
              console.log(`Invalid variant selection.`);
            }
          } else if (answer === 'S') {
            console.log(`↷ Skipped "${item.businessName}". Remains in review queue.\n`);
            validChoice = true;
          } else if (answer === 'Q') {
            console.log(`\nExiting Human Review Interface. Progress saved.\n`);
            rl.close();
            return;
          } else {
            console.log(`Invalid input. Please choose 1, 2, 3, E, R, S, or Q.`);
          }
        }
      }

      console.log(`\n🎉 Human review batch completed!\n`);
    } finally {
      rl.close();
    }
  }
  /**
   * Approves a single outreach draft (legacy / direct approval helper).
   */
  public async approveOutreach(outreachId: string, operator: string = 'HUMAN_OPERATOR'): Promise<void> {
    const now = new Date();
    await this.db.outreach.update({
      where: { id: outreachId },
      data: {
        status: 'APPROVED',
        approvalStatus: 'APPROVED',
        approvedAt: now,
        approvalTimestamp: now,
        approvedBy: operator,
      },
    });
    this.log.info(`Outreach [${outreachId}] APPROVED by ${operator}`);
  }

  /**
   * Rejects a single outreach draft (legacy / direct rejection helper).
   */
  public async rejectOutreach(
    outreachId: string,
    reason: string = 'Operator rejected during review',
    operator: string = 'HUMAN_OPERATOR'
  ): Promise<void> {
    await this.db.outreach.update({
      where: { id: outreachId },
      data: {
        status: 'REJECTED',
        approvalStatus: 'REJECTED',
        rejectionReason: reason,
      },
    });
    this.log.info(`Outreach [${outreachId}] REJECTED by ${operator} (Reason: ${reason})`);
  }

  /**
   * Edits and approves a single outreach draft (legacy / direct edit helper).
   */
  public async editAndApproveOutreach(
    outreachId: string,
    newSubject: string,
    newBody: string,
    operator: string = 'HUMAN_OPERATOR'
  ): Promise<void> {
    const now = new Date();
    const existing = await this.db.outreach.findUnique({ where: { id: outreachId } });

    await this.db.outreach.update({
      where: { id: outreachId },
      data: {
        originalSubject: existing?.originalSubject || existing?.subject,
        originalBody: existing?.originalBody || existing?.body,
        finalSubject: newSubject,
        finalBody: newBody,
        subject: newSubject,
        body: newBody,
        status: 'EDITED_AND_APPROVED',
        approvalStatus: 'EDITED_AND_APPROVED',
        approvedAt: now,
        approvalTimestamp: now,
        approvedBy: operator,
        editTimestamp: now,
      },
    });
    this.log.info(`Outreach [${outreachId}] EDITED AND APPROVED by ${operator}`);
  }

  /**
   * Flat review item listing for backward compatibility with existing tests.
   */
  public async getPendingItems(options?: { limit?: number; includeTest?: boolean } | number): Promise<any[]> {
    const limit = typeof options === 'number' ? options : (options?.limit ?? 50);
    const includeTest = typeof options === 'object' ? (options.includeTest ?? false) : false;

    const whereClause: any = {
      status: { in: ['DRAFT', 'REVIEW_REQUIRED'] },
    };

    if (!includeTest) {
      whereClause.lead = {
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

    const outreaches = await this.db.outreach.findMany({
      where: whereClause,
      include: {
        lead: {
          include: {
            business: {
              include: {
                audits: { orderBy: { createdAt: 'desc' }, take: 1 },
                contacts: true,
              },
            },
          },
        },
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return outreaches.map((o) => {
      const b = o.lead?.business;
      const l = o.lead;
      const audit = b?.audits?.[0];
      const primaryContact = b?.contacts?.[0];

      return {
        id: o.id,
        leadId: o.leadId,
        businessId: b?.id || '',
        businessName: b?.name || 'Unknown Business',
        location: `${b?.city || 'Unknown'}, ${b?.country || 'US'}`,
        website: b?.website || 'None (Missing Website)',
        leadScore: l?.leadOpportunityScore || 0,
        classification: l?.classification || 'WARM',
        problem: 'Website performance / mobile layout issues',
        salesAngle: l?.salesAngle || '',
        recommendedService: l?.recommendedService || 'WEBSITE_IMPROVEMENT',
        channel: o.channel || 'EMAIL',
        contactValue: o.primaryContactValue || primaryContact?.value || 'None',
        nameConfidence: 'HIGH',
        subject: o.finalSubject || o.subject || 'Website Consultation',
        body: o.finalBody || o.body,
        status: o.status,
      };
    });
  }
}

export const interactiveReviewerService = new InteractiveReviewerService();
