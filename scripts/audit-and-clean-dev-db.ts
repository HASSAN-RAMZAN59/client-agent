import { PrismaClient } from '@prisma/client';

async function main() {
  // Connect explicitly to dev.db
  const db = new PrismaClient({
    datasources: {
      db: {
        url: 'file:./dev.db',
      },
    },
  });

  try {
    console.log('\n======================================================================');
    console.log('                 DEV.DB AUDIT & TEST DATA CLEANUP');
    console.log('======================================================================\n');

    // 1. Initial counts
    const totalBizBefore = await db.business.count();
    const totalLeadsBefore = await db.lead.count();
    const totalContactsBefore = await db.contact.count();
    const totalOutreachBefore = await db.outreach.count();
    const totalAuditsBefore = await db.websiteAudit.count();
    const totalCampaignsBefore = await db.campaign.count();

    console.log('INITIAL COUNTS IN DEV.DB:');
    console.log(`• Businesses      : ${totalBizBefore}`);
    console.log(`• Leads           : ${totalLeadsBefore}`);
    console.log(`• Contacts        : ${totalContactsBefore}`);
    console.log(`• Website Audits  : ${totalAuditsBefore}`);
    console.log(`• Outreach Drafts : ${totalOutreachBefore}`);
    console.log(`• Campaigns       : ${totalCampaignsBefore}\n`);

    // 2. Identify test businesses
    const allBusinesses = await db.business.findMany({
      include: {
        lead: {
          include: {
            outreach: true,
          },
        },
        contacts: true,
      },
    });

    const testBizIds: string[] = [];
    const testLeadIds: string[] = [];
    const testContactIds: string[] = [];
    const testOutreachIds: string[] = [];

    const accidentallyApprovedOutreaches: any[] = [];

    for (const b of allBusinesses) {
      const source = (b.source || '').toLowerCase();
      const name = (b.name || '').toLowerCase();

      const isTestBiz =
        source.startsWith('test') ||
        source.includes('mock') ||
        source.includes('fixture') ||
        source === 'test_suite' ||
        name.startsWith('test') ||
        name.startsWith('execution biz') ||
        name.startsWith('contact test') ||
        name.startsWith('batchtest') ||
        name.startsWith('phase11') ||
        name.startsWith('approved biz') ||
        name.startsWith('cooldown biz') ||
        name.startsWith('suppressed') ||
        name.includes('test biz') ||
        name.includes('personalize test') ||
        name.includes('expired biz') ||
        name.includes('suppressed lead biz') ||
        name.includes('gate biz') ||
        name.includes('duplicate biz') ||
        name.includes('pilot test') ||
        name.includes('mock biz') ||
        name.includes('fixture biz') ||
        name.includes('test clinic') ||
        name.includes('scoring test') ||
        name.includes('unittest');

      if (isTestBiz) {
        testBizIds.push(b.id);
        if (b.lead) {
          testLeadIds.push(b.lead.id);
          for (const o of b.lead.outreach) {
            testOutreachIds.push(o.id);
            if (['APPROVED', 'EDITED_AND_APPROVED', 'READY_TO_SEND', 'SENDING'].includes(o.status)) {
              accidentallyApprovedOutreaches.push({
                id: o.id,
                businessName: b.name,
                status: o.status,
                recipient: o.primaryContactValue,
              });
            }
          }
        }
        for (const c of b.contacts) {
          testContactIds.push(c.id);
        }
      }
    }

    console.log('IDENTIFIED TEST FIXTURES IN DEV.DB:');
    console.log(`• Test Businesses      : ${testBizIds.length}`);
    console.log(`• Test Leads           : ${testLeadIds.length}`);
    console.log(`• Test Contacts        : ${testContactIds.length}`);
    console.log(`• Test Outreach Drafts : ${testOutreachIds.length}`);
    console.log(`• Accidentally Approved: ${accidentallyApprovedOutreaches.length}\n`);

    if (accidentallyApprovedOutreaches.length > 0) {
      console.log('ACCIDENTALLY APPROVED TEST RECORDS FOUND:');
      for (const a of accidentallyApprovedOutreaches) {
        console.log(`  - [${a.id}] "${a.businessName}" | Status: ${a.status} | Recipient: ${a.recipient}`);
      }
      console.log('\n');
    }

    // 3. Clean up test records from dev.db
    console.log('Executing cleanup of test fixtures from dev.db...');

    // Delete test outreach records
    if (testOutreachIds.length > 0) {
      const delOutreach = await db.outreach.deleteMany({
        where: { id: { in: testOutreachIds } },
      });
      console.log(`✔ Deleted ${delOutreach.count} test outreach records.`);
    }

    // Delete test leads
    if (testLeadIds.length > 0) {
      const delLeads = await db.lead.deleteMany({
        where: { id: { in: testLeadIds } },
      });
      console.log(`✔ Deleted ${delLeads.count} test leads.`);
    }

    // Delete test contacts
    if (testContactIds.length > 0) {
      const delContacts = await db.contact.deleteMany({
        where: { id: { in: testContactIds } },
      });
      console.log(`✔ Deleted ${delContacts.count} test contacts.`);
    }

    // Delete test audits
    const delAudits = await db.websiteAudit.deleteMany({
      where: { businessId: { in: testBizIds } },
    });
    console.log(`✔ Deleted ${delAudits.count} test website audits.`);

    // Delete test businesses
    if (testBizIds.length > 0) {
      const delBiz = await db.business.deleteMany({
        where: { id: { in: testBizIds } },
      });
      console.log(`✔ Deleted ${delBiz.count} test businesses.`);
    }

    // Also remove test campaigns
    const testCampaigns = await db.campaign.deleteMany({
      where: {
        OR: [
          { name: { startsWith: 'Test' } },
          { name: { contains: 'Test' } },
          { id: { startsWith: 'test' } },
        ],
      },
    });
    console.log(`✔ Deleted ${testCampaigns.count} test campaigns.\n`);

    // 4. Final remaining counts in dev.db
    const totalBizAfter = await db.business.count();
    const totalLeadsAfter = await db.lead.count();
    const totalContactsAfter = await db.contact.count();
    const totalOutreachAfter = await db.outreach.count();
    const totalAuditsAfter = await db.websiteAudit.count();
    const totalCampaignsAfter = await db.campaign.count();

    console.log('======================================================================');
    console.log('REMAINING REAL OPERATIONAL RECORDS IN DEV.DB:');
    console.log('======================================================================');
    console.log(`• Real Businesses      : ${totalBizAfter}`);
    console.log(`• Real Leads           : ${totalLeadsAfter}`);
    console.log(`• Real Contacts        : ${totalContactsAfter}`);
    console.log(`• Real Website Audits  : ${totalAuditsAfter}`);
    console.log(`• Real Outreach Drafts : ${totalOutreachAfter}`);
    console.log(`• Real Campaigns       : ${totalCampaignsAfter}`);
    console.log('======================================================================\n');
  } finally {
    await db.$disconnect();
  }
}

main().catch(console.error);
