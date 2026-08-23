import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function fix() {
  const db = getPrismaClient();
  const cId = '79eae995-f714-4137-b284-85d18de1f929';
  const c = await db.campaign.findUnique({
    where: { id: cId },
    include: {
      businesses: true,
      campaignBusinesses: { include: { business: true } }
    }
  });
  console.log('Campaign:', c?.name, c?.city, c?.country, c?.niche);
  console.log('Direct count before:', c?.businesses.length);
  console.log('Join count before:', c?.campaignBusinesses.length);

  // Check all DB businesses that might belong or not belong
  const allB = await db.business.findMany();
  console.log('Total businesses in DB:', allB.length);

  const allowedNiches = ['dentist', 'hvac', 'dental'];

  let wrongMarketCount = 0;
  let wrongNicheCount = 0;
  let retainedCount = 0;

  for (const b of c?.businesses || []) {
    const isDallas = b.city.toLowerCase().trim() === 'dallas';
    const isUS = ['us', 'usa', 'united states'].includes(b.country.toLowerCase().trim());
    if (!isDallas || !isUS) {
      wrongMarketCount++;
      continue;
    }
    const cat = b.category.toLowerCase().trim();
    const isNiche = allowedNiches.some(n => cat.includes(n)) || cat.includes('orthodont');
    if (!isNiche) {
      wrongNicheCount++;
      continue;
    }
    retainedCount++;
  }

  console.log('Wrong market count:', wrongMarketCount);
  console.log('Wrong niche count:', wrongNicheCount);
  console.log('Retained count:', retainedCount);

  // Also check if any non-Dallas / non-US / non-niche businesses are in the campaign or in DB
  const nonDallas = allB.filter(b => b.city.toLowerCase().trim() !== 'dallas' || !['us', 'usa', 'united states'].includes(b.country.toLowerCase().trim()));
  console.log('Non-Dallas businesses in DB:', nonDallas.length);
  for (const b of nonDallas) {
    if (b.campaignId === cId) {
      console.log('Found non-Dallas business directly attached to campaign:', b.name, b.city, b.country, b.category);
    }
  }

  await disconnectDatabase();
}
fix();
