import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { InteractiveReviewerService } from '../src/modules/outreach/review/interactive-reviewer.service.js';

async function run() {
  const db = getPrismaClient();
  const service = new InteractiveReviewerService(db);
  const groups = await service.getPendingBusinessGroups({
    campaignId: '79eae995-f714-4137-b284-85d18de1f929',
    country: 'US',
    emailOnly: true,
    pilotEligible: true,
  });

  console.log(`=== PENDING BUSINESS GROUPS (${groups.length}) ===`);
  for (const g of groups) {
    console.log(`\nBusiness: "${g.businessName}" | city: "${g.city}" | cat: "${g.niche}" | leadScore: ${g.leadScore} | class: ${g.classification}`);
    console.log(`  Recipient: "${g.recipientEmail}" | Provenance: ${g.provenance.status} | srcUrl: ${g.provenance.sourceUrl}`);
    console.log(`  Problem: "${g.problem}"`);
    console.log(`  SalesAngle: "${g.salesAngle}"`);
    console.log(`  AuditEvidence:`, g.auditEvidence);
    console.log(`  Variants count: ${g.variants.length}`);
    for (const v of g.variants) {
      console.log(`    - [${v.variantKey}] status: ${v.status} | qualityScore: ${v.qualityScore} | qualityBand: ${v.qualityBand}`);
      console.log(`      Subject: ${v.subject}`);
      console.log(`      Body:\n${v.body.split('\n').map(l => '        ' + l).join('\n')}`);
    }
  }

  await disconnectDatabase();
}

run().catch(console.error);
