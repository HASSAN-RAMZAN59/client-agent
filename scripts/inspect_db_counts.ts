import { prisma } from '../src/database/index.js';

async function main() {
  const businesses = await prisma.business.count();
  const leads = await prisma.lead.count();
  const contacts = await prisma.contact.count();
  const audits = await prisma.websiteAudit.count();
  const outreaches = await prisma.outreach.count();
  const campaigns = await prisma.campaign.count();

  console.log({
    campaigns,
    businesses,
    leads,
    contacts,
    audits,
    outreaches,
  });
}

main().finally(async () => {
  await prisma.$disconnect();
});
