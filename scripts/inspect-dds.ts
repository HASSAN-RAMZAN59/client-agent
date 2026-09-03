import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function run() {
  const db = getPrismaClient();
  const dds = await db.business.findFirst({
    where: { name: { contains: 'Dallas Dental Specialists' } },
    include: {
      audits: { orderBy: { createdAt: 'desc' } },
      lead: { include: { outreach: true } },
      contacts: true,
      campaign: true,
      campaignBusinesses: true
    }
  });

  console.log('DDS Business:', {
    id: dds?.id,
    name: dds?.name,
    category: dds?.category,
    city: dds?.city,
    country: dds?.country,
    website: dds?.website,
    campaignId: dds?.campaignId,
    joins: dds?.campaignBusinesses.map(cb => cb.campaignId)
  });
  console.log('DDS Audits count:', dds?.audits.length);
  for (const a of dds?.audits || []) {
    console.log('  Audit:', {
      status: a.status,
      score: a.score,
      loadTimeMs: a.loadTimeMs,
      issuesJson: a.issuesJson,
      findings: a.findings?.slice(0, 100),
      mobileResponsive: a.mobileResponsive
    });
  }
  console.log('DDS Lead:', {
    score: dds?.lead?.leadOpportunityScore,
    classification: dds?.lead?.classification,
    salesAngle: dds?.lead?.salesAngle,
    topProblems: dds?.lead?.topProblems
  });
  console.log('DDS Outreach count:', dds?.lead?.outreach.length);
  for (const o of dds?.lead?.outreach || []) {
    console.log('  Outreach:', {
      id: o.id,
      variant: o.variant,
      status: o.status,
      subject: o.subject,
      bodyExcerpt: o.body.slice(0, 100)
    });
  }
  console.log('DDS Contacts:');
  for (const c of dds?.contacts || []) {
    console.log('  Contact:', {
      type: c.type,
      value: c.value,
      status: c.status,
      isVerified: c.isVerified,
      sourceUrl: c.sourceUrl,
      emailAsFound: (c as any).emailAsFound,
      sourceContext: (c as any).sourceContext
    });
  }

  await disconnectDatabase();
}

run().catch(console.error);
