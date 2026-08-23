import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function checkDallasDentalWebsite() {
  const db = getPrismaClient();
  const cId = '79eae995-f714-4137-b284-85d18de1f929';
  const b = await db.business.findFirst({
    where: {
      campaignId: cId,
      website: { contains: 'dallasdentalspecialists' }
    },
    include: {
      audits: true,
      lead: true
    }
  });

  console.log('Business:', b?.name, b?.website);
  console.log('Audits:', JSON.stringify(b?.audits, null, 2));
  console.log('Lead:', JSON.stringify(b?.lead, null, 2));

  await disconnectDatabase();
}
checkDallasDentalWebsite();
