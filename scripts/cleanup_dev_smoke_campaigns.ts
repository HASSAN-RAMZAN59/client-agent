import { prisma } from '../src/database/index.js';

async function cleanupDevSmokeCampaigns() {
  console.log('--- Inspecting and Cleaning Development Smoke-Test Campaigns ---');

  const smokeCampaignNames = ['test', '1', 'fsd dental fresh start'];
  const campaignsToDelete = await prisma.campaign.findMany({
    where: {
      OR: [
        { name: { in: smokeCampaignNames } },
        { name: { contains: 'smoke' } },
        { name: { contains: 'test' } },
      ],
    },
    include: {
      campaignBusinesses: true,
      businesses: true,
    },
  });

  console.log(`Found ${campaignsToDelete.length} smoke-test campaign(s) to clean:`);
  for (const c of campaignsToDelete) {
    console.log(`- Campaign [${c.id}]: "${c.name}" (Businesses: direct=${c.businesses.length}, join=${c.campaignBusinesses.length})`);

    const bizIds = [
      ...c.businesses.map((b) => b.id),
      ...c.campaignBusinesses.map((cb) => cb.businessId),
    ];

    // Delete CampaignBusiness links
    await prisma.campaignBusiness.deleteMany({
      where: { campaignId: c.id },
    });

    // Delete Outreaches and Leads belonging to these businesses
    for (const bId of bizIds) {
      await prisma.outreach.deleteMany({
        where: { lead: { businessId: bId } },
      });
      await prisma.lead.deleteMany({
        where: { businessId: bId },
      });
      await prisma.websiteAudit.deleteMany({
        where: { businessId: bId },
      });
      await prisma.contact.deleteMany({
        where: { businessId: bId },
      });
      await prisma.business.deleteMany({
        where: { id: bId },
      });
    }

    // Delete the campaign
    await prisma.campaign.delete({
      where: { id: c.id },
    });

    console.log(`  -> Cleaned campaign "${c.name}" and associated records.`);
  }

  const remainingCampaigns = await prisma.campaign.count();
  const remainingBusinesses = await prisma.business.count();
  console.log(`\nCleanup complete. Remaining in dev.db: Campaigns=${remainingCampaigns}, Businesses=${remainingBusinesses}`);
}

cleanupDevSmokeCampaigns()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
