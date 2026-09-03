import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function run() {
  const db = getPrismaClient();
  const campaignId = '79eae995-f714-4137-b284-85d18de1f929';
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      businesses: {
        include: {
          contacts: true,
          audits: { orderBy: { createdAt: 'desc' }, take: 1 },
          lead: { include: { outreach: true } }
        }
      },
      campaignBusinesses: {
        include: {
          business: {
            include: {
              contacts: true,
              audits: { orderBy: { createdAt: 'desc' }, take: 1 },
              lead: { include: { outreach: true } }
            }
          }
        }
      }
    }
  });

  if (!campaign) {
    console.log('Campaign not found');
    await disconnectDatabase();
    return;
  }

  console.log('=== CAMPAIGN', campaign.name, campaign.id);
  const businesses = campaign.businesses;
  console.log(`Total campaign businesses (direct): ${businesses.length}`);

  let wrongCity = 0;
  let wrongState = 0;
  let wrongCountry = 0;
  let wrongNiche = 0;

  for (const b of businesses) {
    const isDallas = (b.city || '').toLowerCase().trim() === 'dallas';
    const isUS = ['US', 'USA', 'UNITED STATES'].includes((b.country || '').toUpperCase().trim());
    const address = b.address || '';
    // check state in address or state field if exists
    const hasTX = /TX\b|Texas\b/i.test(address) || (b as any).state === 'TX';
    // allowed niches: Dentist (including dental variations) or HVAC
    const cat = b.category.toLowerCase();
    const isDentistOrHVAC = cat.includes('dent') || cat.includes('ortho') || cat.includes('hvac');

    if (!isDallas) wrongCity++;
    if (!isUS) wrongCountry++;
    if (!hasTX) wrongState++;
    if (!isDentistOrHVAC) wrongNiche++;

    const emailContacts = b.contacts.filter(c => c.type === 'EMAIL');
    const phoneContacts = b.contacts.filter(c => c.type === 'PHONE');
    if (emailContacts.length > 0) {
      console.log(`[EMAIL FOUND] ${b.name} (${b.category}) | ${b.website}`);
      for (const ec of emailContacts) {
        console.log(`   -> email: ${ec.value} | status: ${ec.status} | isVerif: ${ec.isVerified} | srcUrl: ${ec.sourceUrl} | found: ${(ec as any).emailAsFound}`);
      }
    }
  }

  console.log({
    totalBefore: businesses.length,
    wrongCity,
    wrongState,
    wrongCountry,
    wrongNiche
  });

  // Check all contacts with type EMAIL in campaign businesses
  const allEmails = businesses.flatMap(b => b.contacts.filter(c => c.type === 'EMAIL').map(c => ({ bizName: b.name, cat: b.category, ...c })));
  console.log(`Total email contacts in campaign businesses: ${allEmails.length}`);
  console.log(allEmails);

  await disconnectDatabase();
}

run().catch(console.error);
