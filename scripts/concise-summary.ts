import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function main() {
  const db = getPrismaClient();

  const campaign = await db.campaign.findFirst({
    where: {
      OR: [
        { name: 'test' },
        { city: 'Faisalabad' },
      ],
    },
    include: {
      businesses: {
        include: {
          contacts: true,
          lead: {
            include: {
              outreach: true,
            },
          },
        },
      },
    },
  });

  if (!campaign) {
    console.log('No campaign found.');
    await disconnectDatabase();
    return;
  }

  console.log(`Campaign: "${campaign.name}" | Status: ${campaign.status} | Target: ${campaign.targetBusinesses}`);
  console.log(`Total Businesses: ${campaign.businesses.length}`);

  for (const b of campaign.businesses) {
    const l = b.lead;
    const emailContacts = b.contacts.filter(c => c.type === 'EMAIL');
    const phoneContacts = b.contacts.filter(c => c.type === 'PHONE');
    const platformContacts = b.contacts.filter(c => c.classification === 'PLATFORM_CONTACT');
    
    console.log(`\n• Business: "${b.name}"`);
    console.log(`  Source: ${b.source} | Website: ${b.website}`);
    console.log(`  Contacts: ${b.contacts.length} total (${emailContacts.length} emails, ${phoneContacts.length} phones, ${platformContacts.length} platform)`);
    console.log(`  Lead: score=${l?.leadOpportunityScore ?? 'N/A'}, class=${l?.classification ?? 'NONE'}, primaryVal=${l?.primaryContactValue ?? 'NONE'}`);
    console.log(`  Drafts: ${l?.outreach?.length ?? 0}`);
  }

  await disconnectDatabase();
}

main().catch(console.error);
