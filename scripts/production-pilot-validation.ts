import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { campaignService } from '../src/modules/campaigns/campaign.service.js';
import { CampaignRepository } from '../src/database/repositories/campaign.repository.js';
import { BusinessRepository } from '../src/database/repositories/business.repository.js';
import { WebSearchDiscoveryProvider } from '../src/modules/discovery/web-search-discovery.provider.js';
import { ComprehensiveWebsiteAuditService } from '../src/modules/auditing/comprehensive-website-audit.service.js';
import { LeadScoringService } from '../src/modules/scoring/lead-scoring.service.js';
import { ContactDiscoveryService } from '../src/modules/contact-discovery/contact-discovery.service.js';
import { PersonalizationService } from '../src/modules/personalization/personalization.service.js';
import { OutreachGateService } from '../src/modules/personalization/hardening/outreach-gate.service.js';
import { OutreachRepository } from '../src/database/repositories/outreach.repository.js';
import { SuppressionRepository } from '../src/database/repositories/suppression.repository.js';
import { safeSleep } from '../src/utils/sleeper.js';
import * as fs from 'fs';

async function runProductionPilotValidation() {
  console.log('======================================================================');
  console.log('      PRODUCTION PILOT VALIDATION — DALLAS, TX DENTISTS (100 BIZ)');
  console.log('======================================================================\n');
  console.log('• Market     : Dallas, Texas, USA');
  console.log('• Niche      : Dentists');
  console.log('• Safety Mode: DRY_RUN=true, OUTREACH_ENABLED=false');
  console.log('• Target     : Up to 100 businesses via controlled batches (Limit 10/batch)\n');

  const db = getPrismaClient();
  const campaignRepo = new CampaignRepository(db);
  const businessRepo = new BusinessRepository(db);
  const auditService = new ComprehensiveWebsiteAuditService();
  const scoringService = new LeadScoringService();
  const contactService = new ContactDiscoveryService();
  const personalizationService = new PersonalizationService();
  const gateService = new OutreachGateService(new OutreachRepository(db), new SuppressionRepository(db));

  // 1. Create or retrieve pilot campaign
  const campaignName = `Pilot-Dallas-Dentists-${Date.now()}`;
  const campaign = await campaignRepo.createCampaign({
    name: campaignName,
    country: 'US',
    state: 'TX',
    city: 'Dallas',
    niche: 'Dentist',
    targetBusinesses: 100,
    minLeadScore: 60.0,
    maxDiscoveryPerRun: 10,
    maxEmailsPerDay: 20,
  });

  console.log(`✔ Created Campaign: "${campaign.name}" [${campaign.id}]\n`);

  const provider = new WebSearchDiscoveryProvider();
  const targetTotal = 100;
  const batchSize = 10;
  const allDiscoveredIds = new Set<string>();

  const queries = [
    { city: 'Dallas', niche: 'Dentist' },
    { city: 'Dallas', niche: 'Dental Care' },
    { city: 'Dallas', niche: 'Cosmetic Dentist' },
    { city: 'Dallas', niche: 'Family Dentistry' },
    { city: 'Dallas', niche: 'Orthodontist' },
    { city: 'Dallas', niche: 'Pediatric Dentist' },
    { city: 'Dallas', niche: 'Emergency Dentist' },
    { city: 'Dallas', niche: 'Dental Clinic' },
    { city: 'North Dallas', niche: 'Dentist' },
    { city: 'East Dallas', niche: 'Dentist' },
    { city: 'Downtown Dallas', niche: 'Dentist' },
    { city: 'Uptown Dallas', niche: 'Dentist' },
    { city: 'Oak Cliff', niche: 'Dentist' },
    { city: 'Lake Highlands', niche: 'Dentist' },
  ];

  console.log('>>> Starting Multi-Batch Discovery Runs (Polite Throttled)...\n');

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]!;
    console.log(`--- [Query ${i + 1}/${queries.length}] Discovery: "${q.niche}" in ${q.city}, TX ---`);
    const summary = await provider.discoverDetailed({
      niche: q.niche,
      city: q.city,
      state: 'TX',
      country: 'US',
      limit: batchSize,
    });

    let batchNew = 0;
    for (const item of summary.results) {
      const { business, isNew } = await businessRepo.upsertDiscoveredBusiness(item, item.reachability);
      allDiscoveredIds.add(business.id);
      if (isNew) batchNew++;
    }

    console.log(`    Discovered: ${summary.results.length} | Unique Total: ${allDiscoveredIds.size} (+${batchNew} new)`);

    // Assign to campaign
    await campaignRepo.assignBusinessesToCampaign(campaign.id, Array.from(allDiscoveredIds));

    // Polite delay
    await safeSleep(1500);

    if (allDiscoveredIds.size >= targetTotal) {
      console.log(`\nReached target of ${allDiscoveredIds.size} businesses.`);
      break;
    }
  }

  const businessIdList = Array.from(allDiscoveredIds);
  console.log(`\n======================================================================`);
  console.log(`TOTAL UNIQUE DISCOVERED BUSINESSES: ${businessIdList.length}`);
  console.log(`======================================================================\n`);

  console.log('>>> Executing Full Pipeline (Audit -> Scoring -> Contact Discovery -> Personalization)...\n');

  let processed = 0;
  for (const bId of businessIdList) {
    processed++;
    const biz = await db.business.findUnique({
      where: { id: bId },
      include: {
        audits: { orderBy: { createdAt: 'desc' }, take: 1 },
        lead: { include: { outreach: true } },
        contacts: true,
      },
    });

    if (!biz) continue;

    console.log(`[${processed}/${businessIdList.length}] Processing "${biz.name}" (${biz.website || 'No Website'})...`);

    // A. Audit
    if (biz.website && (!biz.audits || biz.audits.length === 0)) {
      try {
        await auditService.auditBusinessById(biz.id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`    Audit warning: ${msg}`);
      }
    }

    // B. Lead Scoring
    let lead = biz.lead;
    if (!lead) {
      try {
        await scoringService.scoreBusinessById(biz.id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`    Scoring warning: ${msg}`);
      }
    }

    // Fetch updated lead
    lead = (await db.lead.findUnique({ where: { businessId: biz.id }, include: { outreach: true } })) as any;

    // C. Contact Discovery
    if (biz.website) {
      try {
        await contactService.discoverForBusiness(biz.id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`    Contact discovery warning: ${msg}`);
      }
    }

    // D. Personalization
    if (lead) {
      try {
        await personalizationService.personalizeLead(lead.id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`    Personalization warning: ${msg}`);
      }
    }

    await safeSleep(200);
  }

  console.log('\n======================================================================');
  console.log('>>> Aggregating Detailed Pilot Telemetry & Quality Metrics...');
  console.log('======================================================================\n');

  // Fetch all campaign businesses with all nested data
  const finalBusinesses = await db.business.findMany({
    where: { id: { in: businessIdList } },
    include: {
      audits: { orderBy: { createdAt: 'desc' }, take: 1 },
      lead: { include: { outreach: true } },
      contacts: true,
    },
  });

  let totalDiscovered = finalBusinesses.length;
  let uniqueCount = finalBusinesses.length;
  let websiteAvailable = 0;
  let websiteMissing = 0;
  let websiteReachable = 0;
  let websiteBlocked = 0;
  let hotCount = 0;
  let warmCount = 0;
  let coldCount = 0;
  let disqualifiedCount = 0;
  let emailContactable = 0;
  let phoneContactable = 0;
  let formContactable = 0;
  let noContactCount = 0;

  const leadRecords: any[] = [];

  for (const b of finalBusinesses) {
    const hasWeb = Boolean(b.website && b.website.trim().length > 0);
    if (hasWeb) websiteAvailable++;
    else websiteMissing++;

    const audit = b.audits?.[0];
    if (audit) {
      if (audit.status === 'AUDITED' || audit.status === 'PARTIAL') websiteReachable++;
      else if (audit.status === 'BLOCKED' || audit.status === 'ERROR') websiteBlocked++;
    }

    const lead = b.lead;
    if (lead) {
      if (lead.classification === 'HOT') hotCount++;
      else if (lead.classification === 'WARM') warmCount++;
      else if (lead.classification === 'COLD') coldCount++;
      else if (lead.classification === 'DISQUALIFIED') disqualifiedCount++;
    } else {
      coldCount++;
    }

    const contacts = b.contacts || [];
    const hasEmail = contacts.some((c) => c.type === 'EMAIL' && Boolean(c.value));
    const hasPhone = Boolean(b.phone) || contacts.some((c) => c.type === 'PHONE' && Boolean(c.value));
    const hasForm = contacts.some((c) => c.type === 'CONTACT_FORM' && Boolean(c.value));

    if (hasEmail) emailContactable++;
    if (hasPhone) phoneContactable++;
    if (hasForm) formContactable++;
    if (!hasEmail && !hasPhone && !hasForm) noContactCount++;

    const outreaches = lead?.outreach || [];
    const primaryDraft = outreaches.find((o) => o.variant === 'VARIANT_B_STANDARD') || outreaches[0];

    leadRecords.push({
      businessId: b.id,
      name: b.name,
      city: b.city,
      state: 'TX',
      country: b.country,
      website: b.website || null,
      websiteStatus: audit?.status || (b.website ? 'PENDING' : 'NO_WEBSITE'),
      websiteQualityScore: audit?.score ?? null,
      phone: b.phone || null,
      email: contacts.find((c) => c.type === 'EMAIL')?.value || null,
      contactChannel: hasEmail ? 'EMAIL_LEAD' : (hasPhone ? 'PHONE_ONLY_LEAD' : (hasForm ? 'CONTACT_FORM_LEAD' : 'NO_CONTACT_LEAD')),
      discoverySource: b.source,
      leadOpportunityScore: lead?.leadOpportunityScore ?? 0,
      websiteOpportunityScore: lead?.websiteOpportunityScore ?? 0,
      commercialPotentialScore: lead?.commercialPotentialScore ?? 0,
      contactabilityScore: lead?.contactabilityScore ?? 0,
      websiteProblemScore: lead?.websiteProblemScore ?? 0,
      dataConfidenceScore: lead?.dataConfidenceScore ?? 0,
      leadClassification: lead?.classification ?? 'COLD',
      recommendedService: lead?.recommendedService ?? 'WEBSITE_IMPROVEMENT',
      salesAngle: lead?.salesAngle ? JSON.parse(lead.salesAngle) : null,
      topProblems: lead?.topProblems ? JSON.parse(lead.topProblems) : [],
      draftSubject: primaryDraft?.subject || null,
      draftBody: primaryDraft?.body || null,
      draftQualityScore: primaryDraft?.qualityScore ?? 0,
      draftQualityBand: primaryDraft?.qualityBand ?? 'REVIEW_REQUIRED',
      evidenceValid: primaryDraft?.evidenceValid ?? false,
      identityValid: primaryDraft?.identityValid ?? false,
    });
  }

  // Sort leads for Top 20 table
  leadRecords.sort((a, b) => {
    if (b.leadOpportunityScore !== a.leadOpportunityScore) return b.leadOpportunityScore - a.leadOpportunityScore;
    if (b.contactabilityScore !== a.contactabilityScore) return b.contactabilityScore - a.contactabilityScore;
    return b.websiteProblemScore - a.websiteProblemScore;
  });

  const top20 = leadRecords.slice(0, 20);

  const summaryData = {
    campaignId: campaign.id,
    campaignName: campaign.name,
    market: 'Dallas, TX (US)',
    niche: 'Dentist',
    totalDiscovered,
    uniqueCount,
    websiteAvailable,
    websiteMissing,
    websiteReachable,
    websiteBlocked,
    hotCount,
    warmCount,
    coldCount,
    disqualifiedCount,
    emailContactable,
    phoneContactable,
    formContactable,
    noContactCount,
    websiteAvailabilityRate: totalDiscovered > 0 ? Math.round((websiteAvailable / totalDiscovered) * 100) : 0,
    reachabilityRate: websiteAvailable > 0 ? Math.round((websiteReachable / websiteAvailable) * 100) : 0,
    qualificationRate: totalDiscovered > 0 ? Math.round(((hotCount + warmCount) / totalDiscovered) * 100) : 0,
    contactabilityRate: totalDiscovered > 0 ? Math.round(((totalDiscovered - noContactCount) / totalDiscovered) * 100) : 0,
    hotRate: totalDiscovered > 0 ? Math.round((hotCount / totalDiscovered) * 100) : 0,
    warmRate: totalDiscovered > 0 ? Math.round((warmCount / totalDiscovered) * 100) : 0,
    coldRate: totalDiscovered > 0 ? Math.round((coldCount / totalDiscovered) * 100) : 0,
    top20,
    allLeads: leadRecords,
  };

  fs.writeFileSync('scratch_pilot_validation_dallas_dentists.json', JSON.stringify(summaryData, null, 2));

  console.log('======================================================================');
  console.log('                 PILOT VALIDATION SUMMARY METRICS');
  console.log('======================================================================\n');
  console.log(`• Total Discovered       : ${totalDiscovered}`);
  console.log(`• Unique Businesses      : ${uniqueCount}`);
  console.log(`• Websites Available     : ${websiteAvailable} (${summaryData.websiteAvailabilityRate}%)`);
  console.log(`• Websites Missing       : ${websiteMissing}`);
  console.log(`• Websites Reachable     : ${websiteReachable} (${summaryData.reachabilityRate}% of available)`);
  console.log(`• Websites Blocked/Err   : ${websiteBlocked}`);
  console.log(`• HOT Leads              : ${hotCount} (${summaryData.hotRate}%)`);
  console.log(`• WARM Leads             : ${warmCount} (${summaryData.warmRate}%)`);
  console.log(`• COLD Leads             : ${coldCount} (${summaryData.coldRate}%)`);
  console.log(`• Overall Qualified      : ${hotCount + warmCount} (${summaryData.qualificationRate}%)`);
  console.log(`• Email Contactable      : ${emailContactable}`);
  console.log(`• Phone Contactable      : ${phoneContactable}`);
  console.log(`• Contact Form           : ${formContactable}`);
  console.log(`• No Contact Found       : ${noContactCount}\n`);

  await disconnectDatabase();
}

runProductionPilotValidation().catch(async (err) => {
  console.error('Pilot validation error:', err);
  await disconnectDatabase();
  process.exit(1);
});
