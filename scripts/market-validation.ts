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

interface MarketDefinition {
  id: string;
  name: string;
  niche: string;
  city: string;
  country: string;
  limit: number;
}

const MARKETS: MarketDefinition[] = [
  { id: 'MARKET_A', name: 'Dallas Dentists', niche: 'Dentist', city: 'Dallas', country: 'USA', limit: 10 },
  { id: 'MARKET_B', name: 'Dallas HVAC', niche: 'HVAC', city: 'Dallas', country: 'USA', limit: 10 },
  { id: 'MARKET_C', name: 'Miami Roofing', niche: 'Roofing Contractor', city: 'Miami', country: 'USA', limit: 10 },
  { id: 'MARKET_D', name: 'Los Angeles Restaurants', niche: 'Restaurant', city: 'Los Angeles', country: 'USA', limit: 10 },
  { id: 'MARKET_E', name: 'New York Law Firms', niche: 'Law Firm', city: 'New York City', country: 'USA', limit: 10 },
];

async function runMarketValidation() {
  const db = getPrismaClient();
  const discoveryProvider = new WebSearchDiscoveryProvider();
  const businessRepo = new BusinessRepository(db);
  const auditService = new ComprehensiveWebsiteAuditService();
  const scoringService = new LeadScoringService();
  const contactService = new ContactDiscoveryService();
  const personalizationService = new PersonalizationService();
  const gateService = new OutreachGateService();
  const outreachRepo = new OutreachRepository(db);

  const results: any[] = [];
  const startOverall = Date.now();

  console.log('================================================================');
  console.log('      PRODUCTION MARKET VALIDATION & BENCHMARKING RUN');
  console.log('================================================================\n');

  for (const market of MARKETS) {
    const marketStart = Date.now();
    console.log(`\n----------------------------------------------------------------`);
    console.log(`>>> PROCESSING: ${market.name} (${market.niche} in ${market.city}, ${market.country})`);
    console.log(`----------------------------------------------------------------`);

    // 1. Discovery
    const discStart = Date.now();
    const discoverySummary = await discoveryProvider.discoverDetailed({
      niche: market.niche,
      city: market.city,
      country: market.country,
      limit: market.limit,
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

    // Metrics tracking for this market
    let websitesAvailable = 0;
    let websitesReachable = 0;
    let websitesBlocked = 0;
    let websitesAudited = 0;
    let weakWebsitesCount = 0; // score <= 45
    let moderateWebsitesCount = 0; // 46 - 60
    let goodWebsitesCount = 0; // > 60

    let leadsHot = 0;
    let leadsWarm = 0;
    let leadsCold = 0;

    let emailsFound = 0;
    let phonesFound = 0;
    let formsFound = 0;
    let primaryContactFound = 0;
    let officialWebsiteContacts = 0;
    let directoryContacts = 0;
    let searchContacts = 0;

    let draftsCreated = 0;
    let personalizationScores: number[] = [];
    let reviewRequiredCount = 0;
    let readyToSendCount = 0;
    let rejectedCount = 0;

    const marketLeadsDetails: any[] = [];

    // Process each stored business through the entire pipeline
    for (const { business, item } of storedBusinesses) {
      if (business.website) {
        websitesAvailable++;
        if (item.reachability?.status === 'WEBSITE_REACHABLE') websitesReachable++;
        if (item.reachability?.status === 'WEBSITE_BLOCKED') websitesBlocked++;
      }

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

      // 3. Score Lead
      let leadRecord: any = null;
      try {
        leadRecord = await scoringService.scoreBusinessById(business.id);
        if (leadRecord) {
          if (leadRecord.classification === 'HOT') leadsHot++;
          else if (leadRecord.classification === 'WARM') leadsWarm++;
          else leadsCold++;
        }
      } catch (err: any) {
        console.log(`  [Scoring Error for ${business.name}]:`, err?.message);
      }

      // 4. Contact Discovery
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

          for (const c of contacts) {
            if (c.sourceType === 'OFFICIAL_WEBSITE') officialWebsiteContacts++;
            else if (c.sourceType === 'PUBLIC_DIRECTORY') directoryContacts++;
            else searchContacts++;
          }
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

            for (const variant of personalizationResult.variants) {
              const dbDraft = await outreachRepo.getDraftById(variant.id || '');
              if (dbDraft) {
                const gate = await gateService.evaluateDraft(dbDraft.id);
                if (gate.status === 'READY_TO_SEND') readyToSendCount++;
                else if (gate.status === 'REJECTED') rejectedCount++;
                else reviewRequiredCount++;
              }
            }

            const primaryContact = contactResult?.contacts?.find((c: any) => c.isPrimary) || contactResult?.contacts?.[0];

            marketLeadsDetails.push({
              businessName: business.name,
              niche: market.niche,
              city: market.city,
              website: business.website || 'NONE',
              websiteScore: auditRecord?.overallScore ?? 0,
              auditStatus: auditRecord?.status ?? 'NO_WEBSITE',
              leadOpportunityScore: leadRecord.leadOpportunityScore,
              classification: leadRecord.classification,
              priorityRank: leadRecord.priorityRank,
              commercialPotential: leadRecord.breakdown.commercialPotential,
              contactability: leadRecord.breakdown.contactability,
              problemSeverity: leadRecord.breakdown.websiteProblem,
              mobileAppOpportunity: leadRecord.breakdown.mobileAppOpportunity,
              recommendedService: leadRecord.recommendedService,
              primaryContact: primaryContact?.value || 'NONE',
              primaryContactType: primaryContact?.type || 'NONE',
              personalizationScore: personalizationResult.overallPersonalizationScore,
              salesAngle: personalizationResult.salesAngle.opportunity,
            });
          }
        } catch (err: any) {
          console.log(`  [Personalization Error for ${business.name}]:`, err?.message);
        }
      }
    }

    const marketDuration = Date.now() - marketStart;

    const marketSummary = {
      marketId: market.id,
      marketName: market.name,
      niche: market.niche,
      city: market.city,
      country: market.country,
      durationMs: marketDuration,
      discoveredTotal: discoverySummary.results.length,
      newBusinesses: newCount,
      duplicates: dupCount,
      websitesAvailable,
      websitesReachable,
      websitesBlocked,
      websitesAudited,
      weakWebsitesCount,
      moderateWebsitesCount,
      goodWebsitesCount,
      leadsGenerated: marketLeadsDetails.length,
      leadsHot,
      leadsWarm,
      leadsCold,
      emailsFound,
      phonesFound,
      formsFound,
      primaryContactFound,
      officialWebsiteContacts,
      directoryContacts,
      searchContacts,
      draftsCreated,
      avgPersonalizationScore: personalizationScores.length > 0
        ? Math.round(personalizationScores.reduce((a, b) => a + b, 0) / personalizationScores.length)
        : 0,
      minPersonalizationScore: personalizationScores.length > 0 ? Math.min(...personalizationScores) : 0,
      maxPersonalizationScore: personalizationScores.length > 0 ? Math.max(...personalizationScores) : 0,
      reviewRequiredCount,
      readyToSendCount,
      rejectedCount,
      sourceReports: discoverySummary.sourceReports,
      topLeads: marketLeadsDetails.sort((a, b) => b.leadOpportunityScore - a.leadOpportunityScore).slice(0, 20),
    };

    results.push(marketSummary);
  }

  // 6. Scale Timing & DB Size Check
  const totalRunDurationMs = Date.now() - startOverall;
  const dbStats = fs.existsSync('./dev.db') ? fs.statSync('./dev.db') : { size: 0 };
  const memUsage = process.memoryUsage();

  const finalOutput = {
    timestamp: new Date().toISOString(),
    totalRunDurationMs,
    memoryUsageMB: {
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    },
    sqliteSizeBytes: dbStats.size,
    sqliteSizeMB: Number((dbStats.size / 1024 / 1024).toFixed(2)),
    markets: results,
  };

  fs.writeFileSync('./scratch_market_validation_results.json', JSON.stringify(finalOutput, null, 2));

  console.log('\n================================================================');
  console.log(`MARKET VALIDATION COMPLETE in ${(totalRunDurationMs / 1000).toFixed(1)}s`);
  console.log(`Database Size: ${(dbStats.size / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Memory RSS: ${(memUsage.rss / 1024 / 1024).toFixed(1)} MB`);
  console.log('Results saved to ./scratch_market_validation_results.json');
  console.log('================================================================\n');

  await disconnectDatabase();
}

runMarketValidation().catch((err) => {
  console.error('Fatal market validation failure:', err);
  process.exit(1);
});
