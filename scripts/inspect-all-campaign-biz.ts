import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function run() {
  const db = getPrismaClient();
  const campaignId = '79eae995-f714-4137-b284-85d18de1f929';
  const businesses = await db.business.findMany({
    where: {
      OR: [
        { campaignId },
        { campaignBusinesses: { some: { campaignId } } }
      ]
    },
    include: {
      campaignBusinesses: true
    }
  });

  console.log(`Checking ${businesses.length} businesses for campaign ${campaignId}...`);
  for (const b of businesses) {
    console.log(`[${b.id}] "${b.name}" | city: "${b.city}" | country: "${b.country}" | address: "${b.address}" | cat: "${b.category}" | campId: "${b.campaignId}" | cbCount: ${b.campaignBusinesses.length}`);
  }

  await disconnectDatabase();
}

run().catch(console.error);
