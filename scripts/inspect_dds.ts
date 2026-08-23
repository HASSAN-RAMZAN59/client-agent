import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function inspectDds() {
  const db = getPrismaClient();
  const cId = '79eae995-f714-4137-b284-85d18de1f929';
  
  const dds = await db.business.findFirst({
    where: {
      campaignId: cId,
      website: { contains: 'dallasdentalspecialists' }
    },
    include: {
      contacts: true,
      lead: { include: { outreach: true } },
      audits: true
    }
  });

  console.log('=== DALLAS DENTAL SPECIALISTS ===');
  console.log('ID:', dds?.id, 'Name:', dds?.name, 'Website:', dds?.website);
  console.log('Lead ID:', dds?.lead?.id, 'Score:', dds?.lead?.leadOpportunityScore, 'Class:', dds?.lead?.classification);
  console.log('SalesAngle:', dds?.lead?.salesAngle);
  console.log('TopProblems:', dds?.lead?.topProblems);
  console.log('Audits:', dds?.audits);
  console.log('Contacts (count):', dds?.contacts.length);
  for (const c of dds?.contacts || []) {
    console.log(`  ${c.type}: ${c.value} (${c.status}) SourceUrl: ${c.sourceUrl}`);
  }
  console.log('Outreaches:');
  for (const o of dds?.lead?.outreach || []) {
    console.log(`  [${o.id}] ${o.variant} | Status: ${o.status} | Band: ${o.qualityBand} | Score: ${o.qualityScore} | Recipient: ${o.primaryContactValue}`);
    console.log(`    Subject: ${o.subject}`);
    console.log(`    Body:\n${o.body}\n`);
  }

  await disconnectDatabase();
}

inspectDds();
