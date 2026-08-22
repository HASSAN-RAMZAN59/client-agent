import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { PreSendValidator } from '../src/modules/outreach/gate/pre-send-validator.js';

async function main() {
  const db = getPrismaClient();
  const validator = new PreSendValidator(db);

  try {
    const candidates = ['Soho Dental', 'Altima Dental', 'Chapman Air & Heat', 'All About Kids Dentistry'];

    for (const name of candidates) {
      const biz = await db.business.findFirst({
        where: { name: { contains: name } },
        include: {
          contacts: true,
          lead: {
            include: {
              outreach: true,
            },
          },
          audits: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      if (!biz || !biz.lead) {
        console.log(`Business "${name}" not found.`);
        continue;
      }

      console.log('======================================================================');
      console.log(`Business: "${biz.name}" | Location: ${biz.city}, ${biz.country}`);
      console.log(`Website: ${biz.website}`);
      console.log(`Contacts: ${JSON.stringify(biz.contacts.map(c => ({ type: c.type, val: c.value, status: c.status, src: c.sourceUrl })))}`);
      
      for (const o of biz.lead.outreach) {
        const check = await validator.isLivePilotEligible(o.id);
        console.log(`  Draft ID: ${o.id} [${o.status}]`);
        console.log(`  Recipient: ${o.primaryContactValue}`);
        console.log(`  Subject: "${o.subject}"`);
        console.log(`  Validation Reasons: ${check.reasons.join(', ')}`);
        console.log(`  Body:\n${o.body}\n`);
      }
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch(console.error);
