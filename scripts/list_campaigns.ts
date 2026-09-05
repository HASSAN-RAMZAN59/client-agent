import { prisma } from '../src/database/index.js';

async function main() {
  const campaigns = await prisma.campaign.findMany({
    include: {
      businesses: true,
      campaignBusinesses: true,
    },
  });
  console.log(`Total campaigns in dev.db: ${campaigns.length}`);
  for (const c of campaigns) {
    console.log(`- [${c.id}] "${c.name}" (${c.niche}, ${c.city}, ${c.country}) Target: ${c.targetCount}, DirectBiz: ${c.businesses.length}, JoinBiz: ${c.campaignBusinesses.length}, Status: ${c.status}`);
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
