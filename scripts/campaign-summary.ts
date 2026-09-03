import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function run() {
  const db = getPrismaClient();
  const campaigns = await db.campaign.findMany({
    include: {
      businesses: true,
      campaignBusinesses: { include: { business: true } }
    }
  });
  console.log('=== CAMPAIGNS SUMMARY ===');
  for (const c of campaigns) {
    console.log(`Campaign: id=${c.id} name="${c.name}" city="${c.city}" state="${c.state}" niche="${c.niche}" country="${c.country}"`);
    console.log(`  Direct businesses count: ${c.businesses.length}`);
    console.log(`  CampaignBusinesses join count: ${c.campaignBusinesses.length}`);
    
    // Check distribution of cities and categories in direct
    const cities: Record<string, number> = {};
    const categories: Record<string, number> = {};
    const countries: Record<string, number> = {};
    for (const b of c.businesses) {
      cities[b.city] = (cities[b.city] || 0) + 1;
      categories[b.category] = (categories[b.category] || 0) + 1;
      countries[b.country] = (countries[b.country] || 0) + 1;
    }
    console.log('  Direct Cities:', cities);
    console.log('  Direct Categories:', categories);
    console.log('  Direct Countries:', countries);

    const joinCities: Record<string, number> = {};
    for (const cb of c.campaignBusinesses) {
      joinCities[cb.business.city] = (joinCities[cb.business.city] || 0) + 1;
    }
    console.log('  Join Cities:', joinCities);
  }

  // Count businesses in DB by city and category
  const allBiz = await db.business.findMany();
  console.log(`\nTotal businesses in DB: ${allBiz.length}`);
  const cityCount: Record<string, number> = {};
  for (const b of allBiz) {
    cityCount[b.city] = (cityCount[b.city] || 0) + 1;
  }
  console.log('All DB Cities:', cityCount);

  await disconnectDatabase();
}

run().catch(console.error);
