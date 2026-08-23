import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function main() {
  const db = getPrismaClient();
  const campaigns = await db.campaign.findMany();
  console.log('=== CAMPAIGNS ===');
  console.log(JSON.stringify(campaigns, null, 2));

  const businesses = await db.business.findMany({
    include: {
      contacts: true,
      lead: {
        include: {
          outreach: true,
        },
      },
    },
  });
  console.log(`\n=== BUSINESSES (Total: ${businesses.length}) ===`);
  for (const b of businesses) {
    console.log(JSON.stringify({
      id: b.id,
      name: b.name,
      city: b.city,
      country: b.country,
      category: b.category,
      campaignId: b.campaignId,
      website: b.website,
      phone: b.phone,
      source: b.source,
      sourceUrl: b.sourceUrl,
      contacts: b.contacts.map(c => ({
        id: c.id,
        type: c.type,
        value: c.value,
        status: c.status,
        isVerified: c.isVerified,
        sourceUrl: c.sourceUrl,
        sourceType: c.sourceType,
        classification: c.classification,
        discoveredAt: c.discoveredAt,
      })),
      lead: b.lead ? {
        id: b.lead.id,
        score: b.lead.leadOpportunityScore,
        contactDiscoveryStatus: b.lead.contactDiscoveryStatus,
        primaryContactType: b.lead.primaryContactType,
        primaryContactValue: b.lead.primaryContactValue,
        outreach: b.lead.outreach.map(o => ({
          id: o.id,
          status: o.status,
          approvalStatus: o.approvalStatus,
          primaryContactValue: o.primaryContactValue,
        })),
      } : null,
    }, null, 2));
  }
  await disconnectDatabase();
}

main().catch(console.error);
