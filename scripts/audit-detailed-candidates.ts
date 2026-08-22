import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';

async function main() {
  const db = getPrismaClient();
  try {
    const businesses = await db.business.findMany({
      where: {
        AND: [
          { website: { not: null } },
          { contacts: { some: { type: 'EMAIL' } } },
          {
            lead: {
              classification: {
                in: ['HOT', 'WARM'],
              },
            },
          },
          {
            NOT: [
              { source: { startsWith: 'test' } },
              { source: 'TEST_SUITE' },
              { name: { startsWith: 'Test' } },
              { name: { startsWith: 'Execution Biz' } },
              { name: { startsWith: 'Contact Test' } },
              { name: { startsWith: 'BatchTest' } },
              { name: { startsWith: 'Phase11' } },
              { name: { startsWith: 'Approved Biz' } },
              { name: { startsWith: 'Cooldown Biz' } },
              { name: { startsWith: 'Suppressed' } },
            ],
          },
        ],
      },
      include: {
        contacts: true,
        lead: {
          include: {
            outreach: true,
          },
        },
        audits: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: {
        lead: {
          leadOpportunityScore: 'desc',
        },
      },
    });

    console.log(`\n======================================================`);
    console.log(`WARM/HOT CANDIDATES WITH OFFICIAL WEBSITE & EMAIL: ${businesses.length}`);
    console.log(`======================================================\n`);

    for (const b of businesses) {
      // Filter out Sentry/tracking ingest emails
      const emails = b.contacts.filter(c => c.type === 'EMAIL' && !c.value.includes('sentry.io') && !c.value.includes('ingest'));
      if (emails.length === 0) continue;

      console.log(`• Business: "${b.name}" | Location: ${b.city}, ${b.country} | Web: ${b.website}`);
      console.log(`  Emails: ${emails.map(e => e.value).join(', ')}`);
      if (b.lead) {
        console.log(`  Lead ID: ${b.lead.id} | Score: ${b.leadOpportunityScore || b.lead.leadOpportunityScore}/100 (${b.lead.classification})`);
        console.log(`  Sales Angle: ${b.lead.salesAngle}`);
        for (const o of b.lead.outreach) {
          console.log(`    Draft ID: ${o.id} [${o.status}] | Subject: "${o.subject}"`);
          console.log(`    Body:\n${o.body}\n`);
        }
      }
      if (b.audits.length > 0) {
        const a = b.audits[0]!;
        console.log(`  Audit: Score=${a.score}, Findings=${a.findings}`);
      }
      console.log('------------------------------------------------------');
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch(console.error);
