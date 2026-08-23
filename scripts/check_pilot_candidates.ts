import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function checkPilotCandidates() {
  const db = getPrismaClient();
  const cId = '79eae995-f714-4137-b284-85d18de1f929';
  const c = await db.campaign.findUnique({
    where: { id: cId },
    include: {
      businesses: {
        include: {
          contacts: true,
          lead: {
            include: {
              outreach: true
            }
          },
          audits: { orderBy: { createdAt: 'desc' }, take: 1 }
        }
      }
    }
  });

  console.log('Campaign:', c?.name);
  console.log('Businesses count in campaign:', c?.businesses.length);

  for (const b of c?.businesses || []) {
    const l = b.lead;
    const emails = b.contacts.filter(ct => ct.type === 'EMAIL' && ct.status === 'VERIFIED_PUBLIC' && ct.sourceUrl);
    if (emails.length > 0) {
      console.log('----------------------------------------------------');
      console.log(`Business ID: ${b.id} | Name: ${b.name} | City: ${b.city} | Country: ${b.country} | Cat: ${b.category}`);
      console.log(`Website: ${b.website}`);
      console.log(`Lead Score: ${l?.leadOpportunityScore} | Class: ${l?.classification}`);
      console.log(`Sales Angle: ${l?.salesAngle}`);
      console.log(`Top Problems: ${l?.topProblems}`);
      console.log(`Audit Score: ${b.audits[0]?.score}`);
      console.log(`Audit Findings: ${b.audits[0]?.findings}`);
      console.log('Contacts:');
      for (const e of emails) {
        console.log(`  Email: ${e.value} | SourceUrl: ${e.sourceUrl} | EmailAsFound: ${e.emailAsFound}`);
      }
      console.log(`Outreach Drafts (${l?.outreach?.length}):`);
      for (const o of l?.outreach || []) {
        console.log(`  [${o.id}] Variant: ${o.variant} Status: ${o.status} QualityBand: ${o.qualityBand} QualityScore: ${o.qualityScore} Subject: ${o.subject}`);
      }
    }
  }

  await disconnectDatabase();
}
checkPilotCandidates();
