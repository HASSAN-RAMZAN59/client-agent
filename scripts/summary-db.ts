import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function main() {
  const db = getPrismaClient();
  const campaigns = await db.campaign.findMany();
  console.log('=== CAMPAIGNS IN DB ===');
  for (const c of campaigns) {
    const bCount = await db.business.count({ where: { campaignId: c.id } });
    console.log(`Campaign: ID=${c.id}, Name="${c.name}", City="${c.city}", Country="${c.country}", Niche="${c.niche}", BusinessCount=${bCount}`);
  }

  const allBusinesses = await db.business.findMany({
    select: {
      id: true,
      name: true,
      city: true,
      country: true,
      category: true,
      campaignId: true,
      website: true,
      source: true,
      contacts: {
        select: {
          id: true,
          type: true,
          value: true,
          status: true,
          isVerified: true,
          sourceUrl: true,
          classification: true,
        },
      },
    },
  });

  console.log(`\n=== ALL BUSINESSES (${allBusinesses.length}) ===`);
  const byCity: Record<string, number> = {};
  for (const b of allBusinesses) {
    const key = `${b.city}, ${b.country} | ${b.category} | campaignId=${b.campaignId || 'NONE'}`;
    byCity[key] = (byCity[key] || 0) + 1;
    console.log(`[${b.id}] "${b.name}" | City: "${b.city}" | Country: "${b.country}" | Category: "${b.category}" | CampaignId: ${b.campaignId} | Contacts: ${b.contacts.map(c => `${c.type}:${c.value}(${c.status})`).join(', ')}`);
  }

  console.log('\n=== SUMMARY BY GROUP ===');
  console.log(JSON.stringify(byCity, null, 2));

  await disconnectDatabase();
}

main().catch(console.error);
