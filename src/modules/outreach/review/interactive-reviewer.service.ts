import readline from 'readline';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../../database/client.js';
import { createLogger } from '../../../utils/logger.js';
import { OutreachLifecycleStatus, ApprovalAction } from '../../../types/index.js';

export interface InteractiveReviewItem {
  id: string;
  leadId: string;
  businessId: string;
  businessName: string;
  location: string;
  website: string;
  leadScore: number;
  classification: string;
  problem: string;
  salesAngle: string;
  recommendedService: string;
  channel: string;
  contactValue: string;
  nameConfidence: string;
  source: string;
  recordType: 'REAL' | 'TEST';
  provenance: string;
  subject: string;
  body: string;
  status: string;
}

export class InteractiveReviewerService {
  private db: PrismaClient;
  private log = createLogger('InteractiveReviewer');

  constructor(customDb?: PrismaClient) {
    this.db = customDb || getPrismaClient();
  }

  public async getPendingItems(options?: { limit?: number; includeTest?: boolean } | number): Promise<InteractiveReviewItem[]> {
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

      const source = b?.source || 'osm_overpass';
      const isTest =
        source.startsWith('test') ||
        source === 'TEST_SUITE' ||
        (b?.name && (b.name.startsWith('Test') || b.name.includes('Test Biz') || b.name.includes('Personalize Test')));

      let provenanceLabel = 'OSM / DuckDuckGo / Official Website';
      if (source.includes('osm')) provenanceLabel = 'OpenStreetMap (OSM)';
      else if (source.includes('search') || source.includes('ddg')) provenanceLabel = 'DuckDuckGo Web Search';
      else if (isTest) provenanceLabel = 'Automated Test Fixture';

      let salesAngleText = 'Website improvement opportunity';
      if (l?.salesAngle) {
        try {
          const parsed = JSON.parse(l.salesAngle);
          salesAngleText = parsed.problem || parsed.opportunity || parsed.reason || l.salesAngle;
        } catch {
          salesAngleText = l.salesAngle;
        }
      }

      const problemText = l?.topProblems ? (Array.isArray(JSON.parse(l.topProblems)) ? JSON.parse(l.topProblems)[0] : l.topProblems) : (audit?.status === 'NO_WEBSITE' ? 'No official website found' : 'Website performance / mobile layout issues');

      return {
        id: o.id,
        leadId: o.leadId,
        businessId: b?.id || '',
        businessName: b?.name || 'Unknown Business',
        location: `${b?.city || 'Unknown'}, ${b?.country || 'US'}`,
        website: b?.website || 'None (Missing Website)',
        leadScore: l?.leadOpportunityScore || 0,
        classification: l?.classification || 'WARM',
        problem: problemText,
        salesAngle: salesAngleText,
        recommendedService: l?.recommendedService || 'WEBSITE_IMPROVEMENT',
        channel: o.channel || (b?.website ? 'EMAIL' : 'PHONE'),
        contactValue: o.primaryContactValue || primaryContact?.value || b?.phone || 'None',
        nameConfidence: 'HIGH',
        source,
        recordType: isTest ? 'TEST' : 'REAL',
        provenance: provenanceLabel,
        subject: o.finalSubject || o.subject || 'Website Consultation',
        body: o.finalBody || o.body,
        status: o.status,
      };
    });
  }

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

  public async startInteractiveCli(options?: { limit?: number; includeTest?: boolean }): Promise<void> {
    const items = await this.getPendingItems(options || 100);

    if (items.length === 0) {
      console.log('\n✅ No pending drafts in REVIEW_REQUIRED or DRAFT queue.\n');
      return;
    }

    console.log(`\n======================================================================`);
    console.log(`             HUMAN REVIEW INTERFACE — ${items.length} PENDING DRAFTS`);
    console.log(`======================================================================\n`);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const ask = (prompt: string): Promise<string> =>
      new Promise((resolve) => rl.question(prompt, resolve));

    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        console.log(`----------------------------------------------------------------------`);
        console.log(`[Item ${i + 1} of ${items.length}] PROSPECT DETAILS:`);
        console.log(`----------------------------------------------------------------------`);
        console.log(`• Environment          : Operational`);
        console.log(`• Record Type          : ${item.recordType}`);
        console.log(`• Provenance           : ${item.provenance}`);
        console.log(`• Business Name        : ${item.businessName}`);
        console.log(`• Location             : ${item.location}`);
        console.log(`• Website              : ${item.website}`);
        console.log(`• Lead Class & Score   : ${item.classification} (${item.leadScore}/100)`);
        console.log(`• Problem Detected     : ${item.problem}`);
        console.log(`• Sales Angle          : ${item.salesAngle}`);
        console.log(`• Recommended Service  : ${item.recommendedService}`);
        console.log(`• Contact Channel      : ${item.channel}`);
        console.log(`• Contact Value        : ${item.contactValue}`);
        console.log(`• Name Confidence      : ${item.nameConfidence}`);
        console.log(`\n--- PERSONALIZED DRAFT ---`);
        console.log(`Subject: ${item.subject}`);
        console.log(`\n${item.body}\n`);
        console.log(`----------------------------------------------------------------------`);

        let validChoice = false;
        while (!validChoice) {
          const answer = (
            await ask(`Action ([A]pprove / [R]eject / [E]dit / [S]kip / [Q]uit): `)
          ).trim().toUpperCase();

          if (answer === 'A') {
            await this.approveOutreach(item.id);
            console.log(`✔ Approved [${item.businessName}]. Marked as READY_TO_SEND.\n`);
            validChoice = true;
          } else if (answer === 'R') {
            const reason = await ask(`Enter rejection reason (or press enter for default): `);
            await this.rejectOutreach(item.id, reason.trim() || 'Manual operator rejection');
            console.log(`✖ Rejected [${item.businessName}]. Will NOT be contacted.\n`);
            validChoice = true;
          } else if (answer === 'E') {
            console.log(`\nEnter new Subject (leave empty to keep "${item.subject}"):`);
            const editSub = await ask(`New Subject: `);
            console.log(`\nEnter new Body (leave empty to keep current body):`);
            const editBody = await ask(`New Body: `);
            const finalSub = editSub.trim() || item.subject;
            const finalBody = editBody.trim() || item.body;
            await this.editAndApproveOutreach(item.id, finalSub, finalBody);
            console.log(`✔ Draft edited and approved for [${item.businessName}].\n`);
            validChoice = true;
          } else if (answer === 'S') {
            console.log(`↷ Skipped [${item.businessName}]. Remains REVIEW_REQUIRED.\n`);
            validChoice = true;
          } else if (answer === 'Q') {
            console.log(`\nExiting Human Review Interface. Progress saved.\n`);
            rl.close();
            return;
          } else {
            console.log(`Invalid command. Please choose A, R, E, S, or Q.`);
          }
        }
      }

      console.log(`\n🎉 All ${items.length} items reviewed in this batch!\n`);
    } finally {
      rl.close();
    }
  }
}

export const interactiveReviewerService = new InteractiveReviewerService();
