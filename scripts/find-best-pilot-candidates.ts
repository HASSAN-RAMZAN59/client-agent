import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { PreSendValidator } from '../src/modules/outreach/gate/pre-send-validator.js';
import { SuppressionRepository } from '../src/database/repositories/suppression.repository.js';
import { OutreachRepository } from '../src/database/repositories/outreach.repository.js';

async function main() {
  const db = getPrismaClient();
  const suppressionRepo = new SuppressionRepository(db);
  const outreachRepo = new OutreachRepository(db);
  const validator = new PreSendValidator(db, suppressionRepo, outreachRepo);

  try {
    const outreaches = await db.outreach.findMany({
      where: {
        channel: 'EMAIL',
      },
      include: {
        lead: {
          include: {
            business: {
              include: {
                contacts: true,
                audits: { orderBy: { createdAt: 'desc' }, take: 1 },
              },
            },
          },
        },
      },
      orderBy: {
        lead: {
          leadOpportunityScore: 'desc',
        },
      },
    });

    console.log(`Total EMAIL drafts found: ${outreaches.length}`);

    const candidates = [];

    for (const o of outreaches) {
      const biz = o.lead?.business;
      const lead = o.lead;
      const audit = biz?.audits?.[0];

      if (!biz || !lead) continue;

      // Filter out test suites / mock fixtures
      if (
        biz.source?.startsWith('test') ||
        biz.source === 'TEST_SUITE' ||
        biz.name.startsWith('Test') ||
        biz.name.startsWith('Execution Biz') ||
        biz.name.startsWith('Contact Test') ||
        biz.name.startsWith('BatchTest') ||
        biz.name.startsWith('Phase11') ||
        biz.name.startsWith('Approved Biz') ||
        biz.name.startsWith('Cooldown Biz') ||
        biz.name.startsWith('Suppressed')
      ) {
        continue;
      }

      const emailVal = o.primaryContactValue || lead.primaryContactValue;
      if (!emailVal || !emailVal.includes('@')) {
        continue;
      }

      // Check validation
      const eligibility = await validator.isLivePilotEligible(o.id);

      candidates.push({
        outreachId: o.id,
        leadId: lead.id,
        businessName: biz.name,
        city: biz.city,
        country: biz.country,
        website: biz.website,
        source: biz.source,
        score: lead.leadOpportunityScore,
        leadClass: lead.classification,
        contactValue: o.primaryContactValue,
        status: o.status,
        subject: o.subject,
        body: o.body,
        salesAngle: lead.salesAngle,
        audit: audit ? {
          score: audit.score,
          issues: audit.issuesJson,
          findings: audit.findings,
          performance: audit.performanceScore,
        } : null,
        eligibility,
      });
    }

    console.log(`\nFiltered Real Candidates Found: ${candidates.length}\n`);

    for (const c of candidates.slice(0, 10)) {
      console.log('======================================================================');
      console.log(`Business Name      : ${c.businessName}`);
      console.log(`Location           : ${c.city}, ${c.country}`);
      console.log(`Website            : ${c.website}`);
      console.log(`Email              : ${c.contactValue}`);
      console.log(`Score & Class      : ${c.score}/100 (${c.leadClass})`);
      console.log(`Draft Status       : ${c.status}`);
      console.log(`Eligibility        : ${c.eligibility.eligible ? 'ELIGIBLE' : 'BLOCKED'}`);
      console.log(`Blocking Reasons   : ${c.eligibility.reasons.join(', ') || 'None'}`);
      console.log(`Sales Angle        : ${c.salesAngle}`);
      console.log(`Draft Subject      : ${c.subject}`);
      console.log(`Draft Body Preview :\n${c.body.substring(0, 200)}...`);
      console.log('======================================================================\n');
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch(console.error);
