import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function inspectFinal() {
  const db = getPrismaClient();
  const cId = '79eae995-f714-4137-b284-85d18de1f929';
  const businesses = await db.business.findMany({
    where: {
      campaignId: cId,
      name: { in: ['Chapman Air & Heat', 'Dallas Dental Specialists'] }
    },
    include: {
      lead: { include: { outreach: true } },
      contacts: true,
      audits: { orderBy: { createdAt: 'desc' }, take: 1 }
    }
  });

  for (const b of businesses) {
    console.log('======================================================================');
    console.log(`BUSINESS: ${b.name} (${b.category}) [${b.city}, ${b.country}]`);
    console.log(`WEBSITE: ${b.website}`);
    console.log(`CONTACTS:`, b.contacts.map(c => `${c.type}:${c.value} (${c.status})`));
    console.log(`AUDIT: score=${b.audits[0]?.score}, loadTime=${b.audits[0]?.loadTimeMs}ms`);
    console.log('OUTREACH DRAFTS:');
    for (const o of b.lead?.outreach || []) {
      console.log(`\n--- [${o.variant}] Status: ${o.status} | Quality: ${o.qualityScore} ---`);
      console.log(`Subject: ${o.subject}`);
      console.log(`Body:\n${o.body}`);
    }
  }

  await disconnectDatabase();
}

inspectFinal().catch(console.error);
