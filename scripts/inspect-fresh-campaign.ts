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
          audits: true,
        },
      },
    },
  });

  if (!campaign) {
    console.log('No campaign named "test" or with city "Faisalabad" found.');
    await disconnectDatabase();
    return;
  }

  console.log('=== CAMPAIGN ===');
  console.log(`ID: ${campaign.id}`);
  console.log(`Name: ${campaign.name}`);
  console.log(`City: ${campaign.city}, Country: ${campaign.country}, Niche: ${campaign.niche}`);
  console.log(`Status: ${campaign.status}, Target: ${campaign.targetBusinesses}`);
  console.log(`Businesses count: ${campaign.businesses.length}`);

  console.log('\n=== BUSINESSES & LEADS ===');
  for (const b of campaign.businesses) {
    const l = b.lead;
    console.log(`\n--- Business: "${b.name}" ---`);
    console.log(`  ID: ${b.id}`);
    console.log(`  Source: ${b.source} | SourceUrl: ${b.sourceUrl}`);
    console.log(`  Website: ${b.website}`);
    console.log(`  Phone: ${b.phone}`);
    console.log(`  Contacts (${b.contacts.length}):`);
    for (const c of b.contacts) {
      console.log(`    - [${c.type}] ${c.value} | class: ${c.classification} | status: ${c.status} | src: ${c.sourceUrl}`);
    }
    if (l) {
      console.log(`  Lead: score=${l.leadOpportunityScore}, class=${l.classification}, status=${l.status}`);
      console.log(`    primaryType=${l.primaryContactType}, primaryValue=${l.primaryContactValue}, discStatus=${l.contactDiscoveryStatus}`);
      console.log(`    Outreaches/Drafts count: ${l.outreach.length}`);
      for (const o of l.outreach) {
        console.log(`      * Draft [${o.id}] status=${o.status}, channel=${o.channel}, recipient=${o.recipient || o.primaryContactValue}`);
      }
    } else {
      console.log('  Lead: NONE');
    }
  }

  await disconnectDatabase();
}

main().catch(console.error);
