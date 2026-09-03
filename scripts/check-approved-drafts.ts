import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function main() {
  const db = getPrismaClient();
  const d1 = await db.outreach.findUnique({
    where: { id: '0435b4ba-e800-437a-b763-e03d8c2074c3' },
    include: { lead: { include: { business: { include: { contacts: true, audits: true } } } } },
  });
  const d2 = await db.outreach.findUnique({
    where: { id: '4da6b7e8-7e3e-451b-b5b2-ca91d275a91b' },
    include: { lead: { include: { business: { include: { contacts: true, audits: true } } } } },
  });

  console.log('Draft 1 (Chapman):', {
    id: d1?.id,
    business: d1?.lead?.business?.name,
    status: d1?.status,
    approvalStatus: d1?.approvalStatus,
    approvedAt: d1?.approvedAt,
    variant: d1?.variant,
    contact: d1?.primaryContactValue,
  });

  console.log('Draft 2 (DDS):', {
    id: d2?.id,
    business: d2?.lead?.business?.name,
    status: d2?.status,
    approvalStatus: d2?.approvalStatus,
    approvedAt: d2?.approvedAt,
    variant: d2?.variant,
    contact: d2?.primaryContactValue,
  });

  await disconnectDatabase();
}

main().catch(console.error);
