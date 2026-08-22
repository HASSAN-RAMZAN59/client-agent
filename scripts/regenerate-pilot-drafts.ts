import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { PersonalizationService } from '../src/modules/personalization/personalization.service.js';
import { PreSendValidator } from '../src/modules/outreach/gate/pre-send-validator.js';
import { SuppressionRepository } from '../src/database/repositories/suppression.repository.js';
import { OutreachRepository } from '../src/database/repositories/outreach.repository.js';

async function main() {
  const db = getPrismaClient();
  const suppressionRepo = new SuppressionRepository(db);
  const outreachRepo = new OutreachRepository(db);
  const validator = new PreSendValidator(db, suppressionRepo, outreachRepo);
  const personalizationService = new PersonalizationService(db);

  try {
    const businesses = await db.business.findMany({
      where: {
        AND: [
          { website: { not: null } },
          { contacts: { some: { type: 'EMAIL' } } },
          {
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
            ],
          },
        ],
      },
      include: {
        contacts: true,
        lead: {
          include: {
            outreach: true,
          },
        },
        audits: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    console.log(`\n======================================================`);
    console.log(`REGENERATING DRAFTS FOR REAL CANDIDATES: ${businesses.length}`);
    console.log(`======================================================\n`);

    for (const b of businesses) {
      if (!b.lead) continue;

      console.log(`Regenerating drafts for: "${b.name}" (${b.city}, ${b.country})...`);
      const result = await personalizationService.personalizeLead(b.lead.id);

      // Make sure regenerated drafts are REVIEW_REQUIRED
      await db.outreach.updateMany({
        where: { leadId: b.lead.id },
        data: {
          status: 'REVIEW_REQUIRED',
          approvalStatus: 'PENDING',
          approvedAt: null,
          approvedBy: null,
        },
      });

      console.log(`  Generated ${result.variants.length} drafts (Score: ${result.overallPersonalizationScore}/100)`);
    }

    console.log('\n--- Re-auditing Candidates with PreSendValidator ---\n');

    for (const b of businesses) {
      const outreaches = await db.outreach.findMany({
        where: { leadId: b.lead!.id },
      });

      for (const o of outreaches) {
        const check = await validator.isLivePilotEligible(o.id);
        console.log(`• Business: "${b.name}" | Recipient: ${o.primaryContactValue}`);
        console.log(`  Draft ID: ${o.id} [${o.status}]`);
        console.log(`  Subject: "${o.subject}"`);
        console.log(`  Eligibility: ${check.eligible ? 'ELIGIBLE' : 'BLOCKED'}`);
        console.log(`  Reasons: ${check.reasons.join(', ') || 'None'}`);
        console.log(`  Body:\n${o.body}\n`);
        console.log('------------------------------------------------------');
      }
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch(console.error);
