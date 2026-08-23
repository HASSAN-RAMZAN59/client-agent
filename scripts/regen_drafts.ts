import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { PersonalizationService } from '../src/modules/personalization/personalization.service.js';

async function main() {
  const db = getPrismaClient();
  const cId = '79eae995-f714-4137-b284-85d18de1f929';
  const businesses = await db.business.findMany({
    where: {
      campaignId: cId,
      name: { in: ['Chapman Air & Heat', 'Dallas Dental Specialists'] },
    },
    include: { lead: true },
  });

  const pers = new PersonalizationService();

  for (const b of businesses) {
    if (b.lead) {
      console.log('Regenerating drafts for:', b.name);
      const res = await pers.personalizeLead(b.lead.id);
      console.log('Generated', res.variants.length, 'variants for', b.name);
    }
  }

  await disconnectDatabase();
}

main().catch(console.error);
