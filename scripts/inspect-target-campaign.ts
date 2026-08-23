import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function main() {
  const db = getPrismaClient();
  const c = await db.campaign.findUnique({
    where: { id: '79eae995-f714-4137-b284-85d18de1f929' },
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
  console.log('Target Campaign:', JSON.stringify({
    id: c?.id,
    name: c?.name,
    city: c?.city,
    country: c?.country,
    niche: c?.niche,
    status: c?.status,
    businesses: c?.businesses.map(b => ({
      id: b.id,
      name: b.name,
      city: b.city,
      country: b.country,
      category: b.category,
      website: b.website,
      contacts: b.contacts.map(ct => ({ type: ct.type, value: ct.value, status: ct.status, sourceUrl: ct.sourceUrl })),
    })),
  }, null, 2));

  // Also check all outreaches that were fetched when previewPilot was called without campaignId or with campaignId
  const allOutreaches = await db.outreach.findMany({
    include: {
      lead: {
        include: {
          business: {
            include: { contacts: true },
          },
        },
      },
    },
  });
  console.log(`Total Outreaches in DB: ${allOutreaches.length}`);
  for (const o of allOutreaches) {
    const b = o.lead?.business;
    console.log(`Outreach ${o.id} | Biz: "${b?.name}" | City: "${b?.city}" | Country: "${b?.country}" | Category: "${b?.category}" | CampaignId: ${b?.campaignId} | ContactVal: ${o.primaryContactValue}`);
  }

  await disconnectDatabase();
}

main().catch(console.error);
