import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function run() {
  const db = getPrismaClient();
  const campaignId = '79eae995-f714-4137-b284-85d18de1f929';
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      businesses: {
        include: {
          contacts: true,
          audits: { orderBy: { createdAt: 'desc' }, take: 1 },
          lead: { include: { outreach: true } }
        }
      }
    }
  });

  console.log(`Campaign ${campaignId} has ${campaign?.businesses.length} businesses.`);
  const emailBiz = campaign?.businesses.filter(b => b.contacts.some(c => c.type === 'EMAIL')) || [];
  console.log(`Businesses with EMAIL contacts: ${emailBiz.length}`);

  for (const b of emailBiz) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Business: "${b.name}" (ID: ${b.id})`);
    console.log(`Category: "${b.category}" | City: "${b.city}" | Country: "${b.country}" | Website: "${b.website}"`);
    console.log(`Audit status: ${b.audits[0]?.status} | Score: ${b.audits[0]?.score} | loadTimeMs: ${b.audits[0]?.loadTimeMs}`);
    console.log(`Audit issuesJson: ${b.audits[0]?.issuesJson}`);
    console.log(`Lead: score=${b.lead?.leadOpportunityScore} class=${b.lead?.classification} primaryContact=${b.lead?.primaryContactValue} type=${b.lead?.primaryContactType}`);
    for (const c of b.contacts.filter(c => c.type === 'EMAIL')) {
      console.log(`  - Email: ${c.value} | status: ${c.status} | isVerif: ${c.isVerified} | isPublic: ${c.isPublic}`);
      console.log(`    srcUrl: ${c.sourceUrl} | found: ${(c as any).emailAsFound} | ctx: "${(c as any).sourceContext}"`);
    }
  }

  // Also check if there are any other businesses in DB that have city Dallas and category Dentist/HVAC
  const allDallas = await db.business.findMany({
    where: { city: 'Dallas' },
    include: { contacts: true, audits: { orderBy: { createdAt: 'desc' }, take: 1 } }
  });
  console.log(`\nTotal Dallas businesses in DB: ${allDallas.length}`);
  const notInCampaign = allDallas.filter(b => b.campaignId !== campaignId);
  console.log(`Dallas businesses NOT in campaign: ${notInCampaign.length}`);

  await disconnectDatabase();
}

run().catch(console.error);
