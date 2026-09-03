import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function run() {
  const db = getPrismaClient();
  const cId = '79eae995-f714-4137-b284-85d18de1f929';
  const allBiz = await db.business.findMany({
    include: {
      campaignBusinesses: true,
      campaign: true
    }
  });

  console.log(`Total businesses in DB: ${allBiz.length}`);
  const inCampaign79e = allBiz.filter(b => b.campaignId === cId || b.campaignBusinesses.some(cb => cb.campaignId === cId));
  console.log(`Businesses in campaign ${cId}: ${inCampaign79e.length}`);

  const notInCampaign79e = allBiz.filter(b => b.campaignId !== cId && !b.campaignBusinesses.some(cb => cb.campaignId === cId));
  console.log(`Businesses NOT in campaign ${cId}: ${notInCampaign79e.length}`);
  for (const b of notInCampaign79e) {
    if (b.campaignId || b.campaignBusinesses.length > 0) {
      console.log(`Other campaign assignment: [${b.id}] ${b.name} | city: ${b.city} | campId: ${b.campaignId} | joins: ${b.campaignBusinesses.map(cb => cb.campaignId)}`);
    }
  }

  // Let's check non-campaign businesses
  const nonDallasInOther = notInCampaign79e.filter(b => b.city !== 'Dallas');
  console.log(`Non-Dallas businesses: ${nonDallasInOther.length}`);

  await disconnectDatabase();
}

run().catch(console.error);
