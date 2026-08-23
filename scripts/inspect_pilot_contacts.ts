import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function test() {
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

  console.log('Campaign:', c?.name);
  console.log('Businesses count:', c?.businesses.length);
  for (const b of c?.businesses || []) {
    const emails = b.contacts.filter(ct => ct.type === 'EMAIL');
    console.log(`- ${b.name} (${b.category}) [${b.city}, ${b.country}] Website: ${b.website}`);
    if (emails.length > 0) {
      for (const e of emails) {
        console.log(`    Email: ${e.value} | Status: ${e.status} | SourceUrl: ${e.sourceUrl} | EmailAsFound: ${e.emailAsFound}`);
      }
    } else {
      console.log(`    No Email (Contacts: ${b.contacts.map(ct => ct.type + ':' + ct.value).join(', ')})`);
    }
  }

  await disconnectDatabase();
}
test();
