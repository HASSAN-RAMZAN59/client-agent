import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { WebSearchDiscoveryProvider } from '../src/modules/discovery/web-search-discovery.provider.js';
import { BusinessRepository } from '../src/database/repositories/business.repository.js';
import { ComprehensiveWebsiteAuditService } from '../src/modules/auditing/comprehensive-website-audit.service.js';
import { LeadScoringService } from '../src/modules/scoring/lead-scoring.service.js';
import { ContactDiscoveryService } from '../src/modules/contact-discovery/contact-discovery.service.js';
import { PersonalizationService } from '../src/modules/personalization/personalization.service.js';
import { OutreachGateService } from '../src/modules/personalization/hardening/outreach-gate.service.js';
import { OutreachRepository } from '../src/database/repositories/outreach.repository.js';
import fs from 'fs';

interface MarketTarget {
  region: 'US' | 'INTERNATIONAL' | 'PAKISTAN';
  name: string;
  city: string;
  country: string;
  niche: string;
  limit: number;
}

const AUDIT_TARGETS: MarketTarget[] = [
  // A. US
  { region: 'US', name: 'Dallas Dentists', city: 'Dallas', country: 'USA', niche: 'Dentist', limit: 5 },
  { region: 'US', name: 'Houston HVAC', city: 'Houston', country: 'USA', niche: 'HVAC', limit: 5 },
  { region: 'US', name: 'Miami Restaurants', city: 'Miami', country: 'USA', niche: 'Restaurant', limit: 5 },
  { region: 'US', name: 'New York Lawyers', city: 'New York', country: 'USA', niche: 'Lawyer', limit: 5 },

  // B. INTERNATIONAL
  { region: 'INTERNATIONAL', name: 'Toronto Dentists', city: 'Toronto', country: 'Canada', niche: 'Dentist', limit: 5 },
  { region: 'INTERNATIONAL', name: 'London Restaurants', city: 'London', country: 'UK', niche: 'Restaurant', limit: 5 },
  { region: 'INTERNATIONAL', name: 'Sydney Plumbers', city: 'Sydney', country: 'Australia', niche: 'Plumber', limit: 5 },

  // C. PAKISTAN
  { region: 'PAKISTAN', name: 'Lahore Restaurants', city: 'Lahore', country: 'Pakistan', niche: 'Restaurant', limit: 5 },
  { region: 'PAKISTAN', name: 'Islamabad Software Houses', city: 'Islamabad', country: 'Pakistan', niche: 'Software Agency', limit: 5 },
  { region: 'PAKISTAN', name: 'Rawalpindi Car Dealerships', city: 'Rawalpindi', country: 'Pakistan', niche: 'Car Dealership', limit: 5 },
];

async function runPortabilityAudit() {
  const db = getPrismaClient();
  const discoveryProvider = new WebSearchDiscoveryProvider();
  const businessRepo = new BusinessRepository(db);
  const auditService = new ComprehensiveWebsiteAuditService();
  const scoringService = new LeadScoringService();
  const contactService = new ContactDiscoveryService();
  const personalizationService = new PersonalizationService();
  const gateService = new OutreachGateService();
  const outreachRepo = new OutreachRepository(db);

  const marketResults: any[] = [];
  const startOverall = Date.now();

  console.log('================================================================');
  console.log('  PHASE 7.5 — DISCOVERY COVERAGE & MARKET PORTABILITY AUDIT');
  console.log('================================================================\n');

  for (const target of AUDIT_TARGETS) {
    const marketStart = Date.now();
    console.log(`\n----------------------------------------------------------------`);
    console.log(`>>> [${target.region}] ${target.name} (${target.niche} in ${target.city}, ${target.country})`);
    console.log(`----------------------------------------------------------------`);

    // 1. Discovery
    const discStart = Date.now();
    const discoverySummary = await discoveryProvider.discoverDetailed({
      niche: target.niche,
      city: target.city,
      country: target.country,
      limit: target.limit,
    });
    const discDuration = Date.now() - discStart;

    console.log(`[DISCOVERY] Discovered ${discoverySummary.results.length} businesses in ${discDuration}ms.`);

    const storedBusinesses: any[] = [];
    let newCount = 0;
    let dupCount = 0;

    for (const item of discoverySummary.results) {
      const { business, isNew } = await businessRepo.upsertDiscoveredBusiness(item, item.reachability);
      if (isNew) newCount++;
      else dupCount++;
      storedBusinesses.push({ business, item });
    }

    let websitesAvailable = 0;
    let websitesReachable = 0;
    let websitesBlocked = 0;
    let websitesAudited = 0;
    let weakWebsitesCount = 0;
    let moderateWebsitesCount = 0;
    let goodWebsitesCount = 0;

    let leadsHot = 0;
    let leadsWarm = 0;
    let leadsCold = 0;

    let emailsFound = 0;
    let phonesFound = 0;
    let formsFound = 0;
    let primaryContactFound = 0;
    let completeAddressFound = 0;

    let draftsCreated = 0;
    let personalizationScores: number[] = [];
    let leadScores: number[] = [];
    let websiteOpportunityScores: number[] = [];

    const topLeads: any[] = [];

    for (const { business, item } of storedBusinesses) {
      if (business.website) {
        websitesAvailable++;
        if (item.reachability?.status === 'WEBSITE_REACHABLE') websitesReachable++;
        if (item.reachability?.status === 'WEBSITE_BLOCKED') websitesBlocked++;
      }
      if (business.address && business.address.length > 5) completeAddressFound++;

      // 2. Audit
      let auditRecord: any = null;
      try {
        auditRecord = await auditService.auditBusinessById(business.id);
        if (auditRecord) {
          websitesAudited++;
          if (auditRecord.overallScore <= 45) weakWebsitesCount++;
          else if (auditRecord.overallScore <= 60) moderateWebsitesCount++;
          else goodWebsitesCount++;
        }
      } catch (err: any) {
        console.log(`  [Audit Error for ${business.name}]:`, err?.message);
      }

      // 3. Score
      let leadRecord: any = null;
      try {
        leadRecord = await scoringService.scoreBusinessById(business.id);
        if (leadRecord) {
          leadScores.push(leadRecord.leadOpportunityScore);
          websiteOpportunityScores.push(leadRecord.breakdown.websiteOpportunity);

          if (leadRecord.classification === 'HOT') leadsHot++;
          else if (leadRecord.classification === 'WARM') leadsWarm++;
          else leadsCold++;
        }
      } catch (err: any) {
        console.log(`  [Scoring Error for ${business.name}]:`, err?.message);
      }

      // 4. Contacts
      let contactResult: any = null;
      try {
        contactResult = await contactService.discoverForBusiness(business.id);
        if (contactResult) {
          const contacts = contactResult.contacts || [];
          const hasEmail = contacts.some((c: any) => c.type === 'EMAIL');
          const hasPhone = contacts.some((c: any) => c.type === 'PHONE');
          const hasForm = contacts.some((c: any) => c.type === 'CONTACT_FORM');

          if (hasEmail) emailsFound++;
          if (hasPhone) phonesFound++;
          if (hasForm) formsFound++;
          if (hasEmail || hasPhone || hasForm) primaryContactFound++;
        }
      } catch (err: any) {
        console.log(`  [Contact Error for ${business.name}]:`, err?.message);
      }

      // 5. Personalization
      if (leadRecord) {
        try {
          const dbLead = await db.lead.findUnique({ where: { businessId: business.id } });
          if (dbLead) {
            const personalizationResult = await personalizationService.personalizeLead(dbLead.id);
            draftsCreated += personalizationResult.variants.length;
            personalizationScores.push(personalizationResult.overallPersonalizationScore);

            const primaryContact = contactResult?.contacts?.find((c: any) => c.isPrimary) || contactResult?.contacts?.[0];

            topLeads.push({
              businessName: business.name,
              niche: target.niche,
              city: target.city,
              country: target.country,
              website: business.website || 'NONE',
              websiteScore: auditRecord?.overallScore ?? 0,
              leadOpportunityScore: leadRecord.leadOpportunityScore,
              classification: leadRecord.classification,
              priorityRank: leadRecord.priorityRank,
              commercialPotential: leadRecord.breakdown.commercialPotential,
              contactability: leadRecord.breakdown.contactability,
              problemSeverity: leadRecord.breakdown.websiteProblem,
              recommendedService: leadRecord.recommendedService,
              primaryContact: primaryContact?.value || 'NONE',
              primaryContactType: primaryContact?.type || 'NONE',
              countryCode: primaryContact?.country || 'N/A',
              salesAngle: personalizationResult.salesAngle.opportunity,
            });
          }
        } catch (err: any) {
          console.log(`  [Personalization Error for ${business.name}]:`, err?.message);
        }
      }
    }

    const marketDuration = Date.now() - marketStart;
    const discoveredTotal = discoverySummary.results.length;

    marketResults.push({
      region: target.region,
      name: target.name,
      city: target.city,
      country: target.country,
      niche: target.niche,
      durationMs: marketDuration,
      discoveredTotal,
      newBusinesses: newCount,
      duplicates: dupCount,
      websitesAvailable,
      websitesReachable,
      websitesBlocked,
      websitesAudited,
      weakWebsitesCount,
      moderateWebsitesCount,
      goodWebsitesCount,
      leadsHot,
      leadsWarm,
      leadsCold,
      emailsFound,
      phonesFound,
      formsFound,
      completeAddressFound,
      primaryContactFound,
      draftsCreated,
      websiteAvailabilityRate: discoveredTotal > 0 ? Math.round((websitesAvailable / discoveredTotal) * 100) : 0,
      contactAvailabilityRate: discoveredTotal > 0 ? Math.round((primaryContactFound / discoveredTotal) * 100) : 0,
      qualificationRate: discoveredTotal > 0 ? Math.round(((leadsHot + leadsWarm) / discoveredTotal) * 100) : 0,
      hotLeadRate: discoveredTotal > 0 ? Math.round((leadsHot / discoveredTotal) * 100) : 0,
      duplicateRate: (newCount + dupCount) > 0 ? Math.round((dupCount / (newCount + dupCount)) * 100) : 0,
      avgLeadScore: leadScores.length > 0 ? Math.round(leadScores.reduce((a, b) => a + b, 0) / leadScores.length) : 0,
      avgWebsiteOpportunityScore: websiteOpportunityScores.length > 0 ? Math.round(websiteOpportunityScores.reduce((a, b) => a + b, 0) / websiteOpportunityScores.length) : 0,
      sourceReports: discoverySummary.sourceReports,
      topLeads,
    });
  }

  const totalDuration = Date.now() - startOverall;
  const dbStats = fs.existsSync('./dev.db') ? fs.statSync('./dev.db') : { size: 0 };

  const finalOutput = {
    timestamp: new Date().toISOString(),
    totalDurationMs: totalDuration,
    sqliteSizeBytes: dbStats.size,
    markets: marketResults,
  };

  fs.writeFileSync('./scratch_portability_audit_results.json', JSON.stringify(finalOutput, null, 2));

  console.log('\n================================================================');
  console.log(`PORTABILITY AUDIT COMPLETE in ${(totalDuration / 1000).toFixed(1)}s`);
  console.log('Results saved to ./scratch_portability_audit_results.json');
  console.log('================================================================\n');

  await disconnectDatabase();
}

runPortabilityAudit().catch((err) => {
  console.error('Fatal portability audit failure:', err);
  process.exit(1);
});
