import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function run() {
  const db = getPrismaClient();
  const campaign = await db.campaign.update({
    where: { id: '79eae995-f714-4137-b284-85d18de1f929' },
    data: { state: 'TX' },
  });
  console.log(`Updated campaign: ${campaign.id} | name: "${campaign.name}" | state: "${campaign.state}" | city: "${campaign.city}"`);
  await disconnectDatabase();
}

run().catch(console.error);
