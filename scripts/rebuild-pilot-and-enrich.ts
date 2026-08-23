/**
 * Rebuild Campaign Membership & Verified Email Enrichment
 *
 * Campaign: 79eae995-f714-4137-b284-85d18de1f929 (US First Live Pilot)
 * Target: Dallas, TX, US | Dentist, HVAC
 *
 * SAFETY INVARIANTS:
 * - ZERO emails sent
 * - NO SMTP probing
 * - NO email guessing / inference
 * - ZERO out-of-campaign leads in pilot
 */

import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { ContactDiscoveryService } from '../src/modules/contact-discovery/contact-discovery.service.js';
import { preSendValidator } from '../src/modules/outreach/gate/pre-send-validator.js';
import { normalizeCountryCode } from '../src/utils/email-validator.js';
import { normalizeEmail } from '../src/modules/discovery/normalizer.js';

const TARGET_CAMPAIGN_ID = '79eae995-f714-4137-b284-85d18de1f929';

async function main() {
  const db = getPrismaClient();

  console.log('\n======================================================================');
  console.log('       REBUILD CAMPAIGN MEMBERSHIP & VERIFIED EMAIL ENRICHMENT');
  console.log('======================================================================\n');

  // 1. Audit Target Campaign
  let campaign = await db.campaign.findUnique({
    where: { id: TARGET_CAMPAIGN_ID },
  });

  if (!campaign) {
    campaign = await db.campaign.create({
      data: {
        id: TARGET_CAMPAIGN_ID,
        name: 'US First Live Pilot',
        city: 'Dallas',
        country: 'US',
        state: 'TX',
        niche: 'Dentist,HVAC',
        status: 'ACTIVE',
      },
    });
    console.log(`Created campaign ${campaign.id} (${campaign.name})`);
  } else {
    console.log(`Target Campaign: ${campaign.name} [${campaign.id}]`);
    console.log(`Config: City="${campaign.city}", Country="${campaign.country}", Niche="${campaign.niche}"\n`);
  }

  // 2. Audit Existing Associations
  const currentAssocBusinesses = await db.business.findMany({
    where: {
      OR: [
        { campaignId: TARGET_CAMPAIGN_ID },
        { campaignBusinesses: { some: { campaignId: TARGET_CAMPAIGN_ID } } },
      ],
    },
    include: {
      contacts: true,
      lead: { include: { outreach: true } },
    },
  });

  const beforeMembershipCount = currentAssocBusinesses.length;
  console.log(`Before Membership Count: ${beforeMembershipCount}`);

  let wrongMarketCount = 0;
  let wrongNicheCount = 0;
  let correctMembersRetained = 0;
  const wrongMarketBizIds: string[] = [];
  const wrongNicheBizIds: string[] = [];
  const retainedBizIds: string[] = [];

  for (const b of currentAssocBusinesses) {
    const isMarketMatch =
      b.city.toLowerCase().trim() === campaign.city.toLowerCase().trim() &&
      normalizeCountryCode(b.country) === normalizeCountryCode(campaign.country);

    const isNicheMatch = preSendValidator.isNicheMatch(b.category, campaign.niche);

    if (!isMarketMatch) {
      wrongMarketCount++;
      wrongMarketBizIds.push(b.id);
      console.log(`  ❌ Wrong Market Association: "${b.name}" | ${b.city}, ${b.country} (${b.category})`);
    } else if (!isNicheMatch) {
      wrongNicheCount++;
      wrongNicheBizIds.push(b.id);
      console.log(`  ❌ Wrong Niche Association: "${b.name}" | ${b.city}, ${b.country} (${b.category})`);
    } else {
      correctMembersRetained++;
      retainedBizIds.push(b.id);
      console.log(`  ✅ Correct Member Retained: "${b.name}" | ${b.city}, ${b.country} (${b.category})`);
    }
  }

  // Clear wrong associations
  const toClearIds = [...wrongMarketBizIds, ...wrongNicheBizIds];
  if (toClearIds.length > 0) {
    await db.business.updateMany({
      where: { id: { in: toClearIds } },
      data: { campaignId: null },
    });
    await db.campaignBusiness.deleteMany({
      where: {
        campaignId: TARGET_CAMPAIGN_ID,
        businessId: { in: toClearIds },
      },
    });
    console.log(`\nCleared ${toClearIds.length} incorrect association(s).`);
  }

  // 3. Find ALL genuine Dallas Dentist & HVAC businesses in database to associate
  const allDallasCandidates = await db.business.findMany({
    where: {
      NOT: [
        { source: { startsWith: 'test' } },
        { source: 'TEST_SUITE' },
        { name: { startsWith: 'Test' } },
        { name: { startsWith: 'Execution Biz' } },
        { name: { contains: 'Test Biz' } },
      ],
    },
    include: {
      contacts: true,
      lead: { include: { outreach: true } },
    },
  });

  const validDallasTargetIds: string[] = [];
  for (const b of allDallasCandidates) {
    const isMarket =
      b.city.toLowerCase().trim() === 'dallas' &&
      (normalizeCountryCode(b.country) === 'US' || b.country.toLowerCase().includes('united states'));
    const isNiche = preSendValidator.isNicheMatch(b.category, 'Dentist,HVAC');

    if (isMarket && isNiche) {
      validDallasTargetIds.push(b.id);
    }
  }

  console.log(`\nFound ${validDallasTargetIds.length} total genuine Dallas Dentist/HVAC business(es) in database.`);

  // Link valid Dallas targets to campaign via both single relation and join table
  for (const bId of validDallasTargetIds) {
    await db.business.update({
      where: { id: bId },
      data: { campaignId: TARGET_CAMPAIGN_ID },
    });
    await db.campaignBusiness.upsert({
      where: {
        unique_campaign_business: {
          campaignId: TARGET_CAMPAIGN_ID,
          businessId: bId,
        },
      },
      create: {
        campaignId: TARGET_CAMPAIGN_ID,
        businessId: bId,
      },
      update: {},
    });
  }

  const finalMembers = await db.business.findMany({
    where: {
      OR: [
        { campaignId: TARGET_CAMPAIGN_ID },
        { campaignBusinesses: { some: { campaignId: TARGET_CAMPAIGN_ID } } },
      ],
    },
    include: {
      contacts: true,
      lead: { include: { outreach: true } },
    },
  });

  console.log('\n======================================================================');
  console.log('                 CAMPAIGN MEMBERSHIP REBUILD REPORT');
  console.log('======================================================================');
  console.log(`Before membership count:  ${beforeMembershipCount}`);
  console.log(`Wrong-market associations: ${wrongMarketCount}`);
  console.log(`Wrong-niche associations:  ${wrongNicheCount}`);
  console.log(`Correct members retained:  ${correctMembersRetained}`);
  console.log(`Final membership count:    ${finalMembers.length}\n`);

  // 4. Zero-Cost Verified Public Email Enrichment
  console.log('======================================================================');
  console.log('       STARTING ZERO-COST PUBLIC EMAIL ENRICHMENT FOR CAMPAIGN');
  console.log('======================================================================\n');

  const discoveryService = new ContactDiscoveryService();
  let websitesChecked = 0;
  let publicEmailsFound = 0;
  let phoneOnlyLeads = 0;
  const provenanceFailures: string[] = [];
  const validEmailCandidates: any[] = [];

  for (let i = 0; i < finalMembers.length; i++) {
    const biz = finalMembers[i]!;
    console.log(`[${i + 1}/${finalMembers.length}] Evaluating: "${biz.name}" (${biz.category}) - ${biz.website || 'NO WEBSITE'}`);

    // First clean up any existing synthetic/guessed email contacts without real source evidence
    const existingEmails = biz.contacts.filter((c) => c.type === 'EMAIL');
    for (const em of existingEmails) {
      // If email was guessed (e.g. admin@allaboutkidsdentist.com with no emailAsFound or synthetic)
      // verify if it really exists by crawling the official site
      if (!em.sourceUrl || !em.emailAsFound || !em.sourceContext) {
        await db.contact.update({
          where: { id: em.id },
          data: { status: 'NONE_FOUND', isVerified: false },
        });
      }
    }

    if (biz.website && biz.website.trim().length > 0) {
      websitesChecked++;
      try {
        const discResult = await discoveryService.discoverForBusiness(biz.id, { dryRun: false });
        const discoveredEmail = discResult.contacts.find((c) => c.type === 'EMAIL' && c.status === 'VERIFIED_PUBLIC');

        if (discoveredEmail) {
          publicEmailsFound++;
          console.log(`   📧 Public Email Found: ${discoveredEmail.value} (Source: ${discoveredEmail.sourceUrl})`);
          validEmailCandidates.push({
            business: biz.name,
            email: discoveredEmail.value,
            sourceUrl: discoveredEmail.sourceUrl,
            sourceContext: discoveredEmail.sourceContext,
            emailAsFound: discoveredEmail.emailAsFound,
            timestamp: discoveredEmail.discoveredAt,
          });
        } else {
          phoneOnlyLeads++;
          console.log(`   📞 No verifiable public email found. Designated as PHONE_ONLY_LEAD.`);
          // Ensure lead is marked phone primary
          const phoneContact = discResult.contacts.find((c) => c.type === 'PHONE');
          if (phoneContact) {
            await db.lead.updateMany({
              where: { businessId: biz.id },
              data: {
                primaryContactType: 'PHONE',
                primaryContactValue: phoneContact.value,
                contactDiscoveryStatus: 'VERIFIED_PUBLIC',
              },
            });
          }
        }
      } catch (err: any) {
        console.log(`   ⚠ Web enrichment error for ${biz.name}: ${err.message}`);
        phoneOnlyLeads++;
      }
    } else {
      phoneOnlyLeads++;
      console.log(`   📞 No website. Designated as PHONE_ONLY_LEAD.`);
    }
  }

  console.log('\n======================================================================');
  console.log('                 ENRICHMENT SUMMARY REPORT');
  console.log('======================================================================');
  console.log(`Dallas businesses evaluated: ${finalMembers.length}`);
  console.log(`Websites checked:            ${websitesChecked}`);
  console.log(`Public emails actually found:${publicEmailsFound}`);
  console.log(`Phone-only leads:            ${phoneOnlyLeads}`);
  console.log(`Final valid email candidates:${validEmailCandidates.length}`);
  console.log('======================================================================\n');

  await disconnectDatabase();
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});
