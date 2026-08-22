/**
 * US First Live Pilot — Campaign Creation & Candidate Audit
 *
 * This script:
 * 1. Creates a "US First Live Pilot" campaign (or finds existing)
 * 2. Queries all real US EMAIL candidates with full provenance validation
 * 3. Displays a detailed audit report
 *
 * SAFETY: Does NOT send email, does NOT approve drafts, does NOT modify safety flags.
 *
 * Usage:
 *   npx tsx scripts/create-us-pilot-campaign.ts
 */

import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { isStrictlyValidEmail, normalizeCountryCode } from '../src/utils/email-validator.js';

async function main() {
  const db = getPrismaClient();

  console.log('\n=================================================================');
  console.log('       US FIRST LIVE PILOT — CAMPAIGN & CANDIDATE AUDIT');
  console.log('=================================================================\n');

  // 1. Create or find campaign
  let campaign = await db.campaign.findFirst({
    where: { name: 'US First Live Pilot' },
  });

  if (!campaign) {
    campaign = await db.campaign.create({
      data: {
        name: 'US First Live Pilot',
        niche: 'Dentist,HVAC',
        city: 'Dallas',
        country: 'US',
        status: 'ACTIVE',
      },
    });
    console.log(`✅ Created campaign: ${campaign.id} — ${campaign.name}`);
  } else {
    console.log(`✅ Found existing campaign: ${campaign.id} — ${campaign.name}`);
  }

  // 2. Find all US businesses and leads
  const businesses = await db.business.findMany({
    where: {
      NOT: [
        { source: { startsWith: 'test' } },
        { source: 'TEST_SUITE' },
        { name: { startsWith: 'Test' } },
        { name: { contains: 'Test Biz' } },
      ],
    },
    include: {
      contacts: true,
      audits: { orderBy: { createdAt: 'desc' }, take: 1 },
      campaign: true,
      lead: {
        include: {
          outreach: true,
        },
      },
    },
    take: 50,
  });

  console.log(`\nFound ${businesses.length} non-test business record(s) in database.\n`);

  if (businesses.length === 0) {
    console.log('No businesses found in database.\n');
    await disconnectDatabase();
    return;
  }

  // 3. Detailed audit
  console.log('─'.repeat(140));
  console.log(
    '#'.padEnd(4) +
    'Business'.padEnd(24) +
    'City/Country'.padEnd(16) +
    'Email'.padEnd(28) +
    'Valid Syntax'.padEnd(14) +
    'Status'.padEnd(16) +
    'Source URL'.padEnd(14) +
    'Quality'.padEnd(10) +
    'Pilot Eligible'
  );
  console.log('─'.repeat(140));

  let assignedCount = 0;
  let validCandidateCount = 0;

  for (let i = 0; i < businesses.length; i++) {
    const b = businesses[i]!;
    const l = b.lead;
    const emailContact = b.contacts?.find((c) => c.type === 'EMAIL');
    const email = emailContact?.value || '';
    const emailCheck = isStrictlyValidEmail(email);
    const contactStatus = emailContact?.status || 'NONE_FOUND';
    const sourceUrl = emailContact?.sourceUrl || '';
    const hasSourceUrl = Boolean(sourceUrl && (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')));
    const isUS = normalizeCountryCode(b.country) === 'US';
    const isVerifiedPublic = contactStatus === 'VERIFIED_PUBLIC' && emailContact?.isVerified;

    let candidateQuality = 'INVALID';
    let eligible = false;
    let blockReason = '';

    if (!emailCheck.valid) {
      blockReason = email ? `INVALID_EMAIL_SYNTAX (${emailCheck.reason})` : 'NO_EMAIL_CONTACT';
    } else if (!isUS) {
      blockReason = `PILOT_COUNTRY_MISMATCH (${b.country})`;
    } else if (!hasSourceUrl) {
      blockReason = 'EMAIL_SOURCE_NOT_VERIFIABLE (No Source URL)';
    } else if (!isVerifiedPublic) {
      blockReason = `CONTACT_STATUS_NOT_VERIFIED (${contactStatus})`;
    } else {
      candidateQuality = 'VALID';
      eligible = true;
      validCandidateCount++;
    }

    console.log(
      `#${i + 1}`.padEnd(4) +
      b.name.slice(0, 22).padEnd(24) +
      `${b.city || '?'}, ${b.country || '?'}`.slice(0, 14).padEnd(16) +
      (email || '(None)').slice(0, 26).padEnd(28) +
      (emailCheck.valid ? 'YES' : 'NO').padEnd(14) +
      contactStatus.slice(0, 14).padEnd(16) +
      (hasSourceUrl ? sourceUrl.slice(0, 12) + '..' : 'NONE').padEnd(14) +
      candidateQuality.padEnd(10) +
      (eligible ? 'YES' : `NO - ${blockReason}`)
    );

    // Assign to campaign if business is in US and not yet assigned
    if (isUS && !b.campaignId) {
      await db.business.update({
        where: { id: b.id },
        data: { campaignId: campaign.id },
      });
      assignedCount++;
    }
  }

  console.log('─'.repeat(140));
  console.log(`\n✅ Assigned ${assignedCount} business(es) to campaign "${campaign.name}".`);
  console.log(`📋 Total Valid Candidates with Strict Provenance: ${validCandidateCount}`);
  console.log(`📋 Campaign ID for pilot-preview:\n   ${campaign.id}\n`);
  console.log('Next step:');
  console.log(`   npm run cli -- pilot-preview --campaign ${campaign.id} --country US --limit 2\n`);

  await disconnectDatabase();
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
