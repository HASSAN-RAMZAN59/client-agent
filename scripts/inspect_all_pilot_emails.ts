import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function inspectAll() {
  const db = getPrismaClient();
  const cId = '79eae995-f714-4137-b284-85d18de1f929';
  const c = await db.campaign.findUnique({
    where: { id: cId },
    include: {
      businesses: {
        include: {
          contacts: true,
          lead: { include: { outreach: true } }
        }
      }
    }
  });

  for (const b of c?.businesses || []) {
    const emails = b.contacts.filter(ct => ct.type === 'EMAIL');
    if (emails.length > 0) {
      console.log('=== BUSINESS WITH EMAIL: ' + b.name + ' (' + b.category + ') ===');
      console.log('Website:', b.website);
      for (const e of emails) {
        console.log('  Email:', e.value);
        console.log('  Status:', e.status);
        console.log('  SourceUrl:', e.sourceUrl);
        console.log('  EmailAsFound:', e.emailAsFound);
        console.log('  SourceContext:', e.sourceContext);
        console.log('  DiscoveredAt:', e.discoveredAt);
      }
      console.log('  Outreach count:', b.lead?.outreach?.length);
      for (const o of b.lead?.outreach || []) {
        console.log('    Outreach:', o.id, o.status, o.primaryContactValue, o.approvalStatus);
      }
    }
  }

  await disconnectDatabase();
}
inspectAll();
