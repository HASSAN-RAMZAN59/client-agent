import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function check() {
  const db = getPrismaClient();
  const approved = await db.outreach.findMany({
    where: {
      status: { in: ['APPROVED', 'READY_TO_SEND', 'SENT'] },
    },
    include: {
      lead: { include: { business: true } },
    },
  });

  console.log(`=== CURRENT APPROVED / READY_TO_SEND / SENT OUTREACH: ${approved.length} ===`);
  for (const o of approved) {
    console.log(`- ID: ${o.id} | Biz: "${o.lead?.business?.name}" | Status: ${o.status} | Approval: ${o.approvalStatus}`);
  }

  const campaignOutreaches = await db.outreach.findMany({
    where: {
      lead: {
        business: {
          OR: [
            { campaignId: '79eae995-f714-4137-b284-85d18de1f929' },
            { name: { in: ['Chapman Air & Heat', 'Dallas Dental Specialists'] } },
          ],
        },
      },
    },
    include: {
      lead: { include: { business: true } },
    },
  });

  console.log(`\n=== CAMPAIGN DRAFTS STATUSES (${campaignOutreaches.length}) ===`);
  const statusCounts: Record<string, number> = {};
  for (const o of campaignOutreaches) {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
  }
  console.log(statusCounts);

  await disconnectDatabase();
}

check().catch(console.error);
