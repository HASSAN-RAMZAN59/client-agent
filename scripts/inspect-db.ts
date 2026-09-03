import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function run() {
  const db = getPrismaClient();
  const campaigns = await db.campaign.findMany({
    include: {
      businesses: true,
      campaignBusinesses: { include: { business: true } }
    }
  });
  console.log('=== CAMPAIGNS ===');
  for (const c of campaigns) {
    console.log(`Campaign: id=${c.id} name="${c.name}" city="${c.city}" niche="${c.niche}" country="${c.country}"`);
    console.log(`  Direct businesses count: ${c.businesses.length}`);
    console.log(`  CampaignBusinesses join count: ${c.campaignBusinesses.length}`);
    const directIds = new Set(c.businesses.map(b => b.id));
    for (const b of c.businesses) {
      console.log(`    - [DIRECT] ${b.id} | ${b.name} | city: ${b.city} | state: ${(b as any).state} | country: ${b.country} | cat: ${b.category} | website: ${b.website}`);
    }
    for (const cb of c.campaignBusinesses) {
      const b = cb.business;
      console.log(`    - [JOIN] ${b.id} | ${b.name} | city: ${b.city} | state: ${(b as any).state} | country: ${b.country} | cat: ${b.category} | website: ${b.website}`);
    }
  }

  const allBusinesses = await db.business.findMany({
    include: {
      contacts: true,
      audits: { orderBy: { createdAt: 'desc' }, take: 1 },
      lead: { include: { outreach: true } }
    }
  });

  console.log(`\n=== ALL BUSINESSES IN DB (${allBusinesses.length}) ===`);
  for (const b of allBusinesses) {
    console.log(`[${b.id}] "${b.name}" | city: "${b.city}" | country: "${b.country}" | cat: "${b.category}" | campId: ${b.campaignId} | source: ${b.source} | website: ${b.website}`);
    if (b.contacts.length > 0) {
      for (const ct of b.contacts) {
        console.log(`    Contact: type=${ct.type} val="${ct.value}" status=${ct.status} isVerif=${ct.isVerified} srcUrl="${ct.sourceUrl}" emailAsFound="${(ct as any).emailAsFound}"`);
      }
    } else {
      console.log(`    No contacts`);
    }
    if (b.audits.length > 0) {
      const a = b.audits[0];
      console.log(`    Audit: status=${a?.status} score=${a?.score} loadTime=${a?.loadTimeMs} issuesJson=${a?.issuesJson?.slice(0, 100)}`);
    }
    if (b.lead) {
      console.log(`    Lead: id=${b.lead.id} score=${b.lead.leadOpportunityScore} class=${b.lead.classification} outreachCount=${b.lead.outreach.length}`);
    }
  }

  await disconnectDatabase();
}

run().catch(console.error);
