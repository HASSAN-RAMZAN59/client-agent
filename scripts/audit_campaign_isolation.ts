import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function run() {
  const prisma = getPrismaClient();
  const cId = '79eae995-f714-4137-b284-85d18de1f929';
  const c = await prisma.campaign.findUnique({
    where: { id: cId },
    include: {
      businesses: true,
      campaignBusinesses: { include: { business: true } }
    }
  });
  console.log('Campaign:', c ? { id: c.id, name: c.name, city: c.city, country: c.country, niche: c.niche } : 'Not found');
  console.log('Direct businesses:', c ? c.businesses.length : 0);
  console.log('Join table businesses:', c ? c.campaignBusinesses.length : 0);
  
  if (c) {
    const directCounts: Record<string, number> = {};
    for (const b of c.businesses) {
      const k = `${b.city} (${b.country}) - ${b.category}`;
      directCounts[k] = (directCounts[k] || 0) + 1;
    }
    console.log('Direct breakdown:', directCounts);

    const joinCounts: Record<string, number> = {};
    for (const cb of c.campaignBusinesses) {
      const b = cb.business;
      const k = `${b.city} (${b.country}) - ${b.category}`;
      joinCounts[k] = (joinCounts[k] || 0) + 1;
    }
    console.log('Join breakdown:', joinCounts);
  }

  const allB = await prisma.business.findMany();
  console.log('Total businesses:', allB.length);
  const allCounts: Record<string, number> = {};
  for (const b of allB) {
    const k = `${b.city} (${b.country}) - ${b.category}`;
    allCounts[k] = (allCounts[k] || 0) + 1;
  }
  console.log('All DB businesses breakdown:', allCounts);

  await disconnectDatabase();
}
run();
