import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function inspectCandidates() {
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
  console.log('Audits:', JSON.stringify(dds?.audits, null, 2));
  console.log('Contacts:', JSON.stringify(dds?.contacts, null, 2));
  console.log('Outreaches:', JSON.stringify(dds?.lead?.outreach?.map(o => ({ id: o.id, variant: o.variant, status: o.status, subject: o.subject, body: o.body, qualityBand: o.qualityBand })), null, 2));

  const chapman = await db.business.findFirst({
    where: {
      campaignId: cId,
      name: { contains: 'Chapman' }
    },
    include: {
      contacts: true,
      lead: { include: { outreach: true } },
      audits: true
    }
  });

  console.log('\n=== CHAPMAN AIR & HEAT ===');
  console.log('ID:', chapman?.id, 'Name:', chapman?.name, 'Website:', chapman?.website);
  console.log('Lead ID:', chapman?.lead?.id, 'Score:', chapman?.lead?.leadOpportunityScore, 'Class:', chapman?.lead?.classification);
  console.log('SalesAngle:', chapman?.lead?.salesAngle);
  console.log('TopProblems:', chapman?.lead?.topProblems);
  console.log('Audits:', JSON.stringify(chapman?.audits, null, 2));
  console.log('Contacts:', JSON.stringify(chapman?.contacts, null, 2));
  console.log('Outreaches:', JSON.stringify(chapman?.lead?.outreach?.map(o => ({ id: o.id, variant: o.variant, status: o.status, subject: o.subject, body: o.body, qualityBand: o.qualityBand })), null, 2));

  await disconnectDatabase();
}

inspectCandidates();
