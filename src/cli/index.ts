#!/usr/bin/env node
import { Command } from 'commander';
import { z } from 'zod';
import { HealthService } from '../services/health.service.js';
import { analyticsService } from '../modules/analytics/analytics.service.js';
import { leadPipelineService } from '../services/lead-pipeline.service.js';
import { LeadRepository } from '../database/repositories/lead.repository.js';
import { BusinessRepository } from '../database/repositories/business.repository.js';
import { WebSearchDiscoveryProvider } from '../modules/discovery/web-search-discovery.provider.js';
import { MockBusinessDiscoveryProvider } from '../modules/discovery/mock-discovery.provider.js';
import { safetyControls } from '../config/safety.js';
import { disconnectDatabase } from '../database/client.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';

const program = new Command();

program
  .name('lead-gen')
  .description('Production-quality, Zero-Cost Client Acquisition & Lead Generation Automation System')
  .version('0.2.5 (Phase 2 Hardened)');

// ------------------------------------------------------------------------------
// Status / Health Check Command
// ------------------------------------------------------------------------------
program
  .command('status')
  .alias('health')
  .description('Verify Node environment, SQLite database connection, config, and safety controls')
  .action(async () => {
    try {
      console.log('\n======================================================');
      console.log('   SYSTEM HEALTH & ENVIRONMENT STATUS (PHASE 2.5)');
      console.log('======================================================\n');

      const health = await HealthService.getStatus();

      console.log(`• Overall Status     : ${health.status.toUpperCase()}`);
      console.log(`• Application Version: ${health.version}`);
      console.log(`• Node.js Version    : ${health.nodeVersion}`);
      console.log(`• Environment        : ${health.environment}`);
      console.log(`• Database Status    : ${health.database.connected ? 'CONNECTED (SQLite)' : 'DISCONNECTED'}`);
      if (health.database.latencyMs !== undefined) {
        console.log(`• Database Latency   : ${health.database.latencyMs}ms`);
      }
      if (health.database.error) {
        console.log(`• Database Error     : ${health.database.error}`);
      }

      console.log('\n--- Safety Controls & Source Budgets ---');
      console.log(`• DRY_RUN Mode           : ${health.configuration.dryRun} (Safe simulation mode)`);
      console.log(`• MAX_ITEMS_PER_RUN      : ${health.configuration.maxItemsPerRun}`);
      console.log(`• MAX_SOURCE_REQUESTS    : ${health.configuration.maxSourceRequestPerRun}`);
      console.log(`• REQUEST_DELAY_MS       : ${health.configuration.requestDelayMs}ms`);
      console.log(`• OSM Source Enabled     : ${health.configuration.discoveryOsmEnabled}`);
      console.log(`• DDG Search Enabled     : ${health.configuration.discoveryDdgEnabled}`);
      console.log(`• MAX_EMAILS_PER_RUN     : ${config.MAX_EMAILS_PER_RUN}`);
      console.log(`• MAX_RETRIES            : ${config.MAX_RETRIES}`);
      console.log(`• COOLDOWN_MS            : ${config.COOLDOWN_MS}ms\n`);

      if (health.status === 'healthy') {
        console.log('✔ All system checks passed successfully.\n');
      } else {
        console.error('✖ System check identified issues. Review logs above.\n');
        process.exitCode = 1;
      }
    } catch (err) {
      logger.error('Failed to retrieve system status', err);
      process.exitCode = 1;
    } finally {
      await disconnectDatabase();
    }
  });

// ------------------------------------------------------------------------------
// Discovery Command (Phase 2.5 Hardened Discovery Engine)
// ------------------------------------------------------------------------------
const discoveryInputSchema = z.object({
  niche: z.string().min(1, 'Niche is required').default('Dentist'),
  city: z.string().min(1, 'City is required').default('Dallas'),
  country: z.string().min(1, 'Country is required').default('USA'),
  limit: z.coerce.number().int().positive().default(10),
  mock: z.boolean().default(false),
});

program
  .command('discover')
  .description('Discover legitimate businesses from public web sources, check websites, and persist to SQLite')
  .option('-n, --niche <niche>', 'Target industry or category (e.g. Dentist, Plumber, Lawyer)', 'Dentist')
  .option('-c, --city <city>', 'Target city (e.g. Dallas, Austin, Chicago)', 'Dallas')
  .option('--country <country>', 'Target country', 'USA')
  .option('-l, --limit <number>', 'Target number of prospects (clamped to MAX_ITEMS_PER_RUN)', '10')
  .option('--mock', 'Run local mock discovery for offline testing', false)
  .action(async (options) => {
    try {
      const parsed = discoveryInputSchema.safeParse(options);
      if (!parsed.success) {
        console.error('\n✖ Invalid Discovery Arguments:');
        parsed.error.errors.forEach((err) => {
          console.error(`  - ${err.path.join('.')}: ${err.message}`);
        });
        process.exitCode = 1;
        return;
      }

      const { niche, city, country, limit: requestedLimit, mock } = parsed.data;
      const maxAllowed = safetyControls.getPolicy().maxItemsPerRun;
      const effectiveLimit = Math.min(requestedLimit, maxAllowed);

      console.log('\n======================================================');
      console.log('       BUSINESS DISCOVERY ENGINE (PHASE 2.5)');
      console.log('======================================================\n');
      console.log(`• Target Niche    : ${niche}`);
      console.log(`• Target Location : ${city}, ${country}`);
      console.log(`• Requested Limit : ${requestedLimit}`);
      console.log(`• Effective Limit : ${effectiveLimit} (Clamped by MAX_ITEMS_PER_RUN: ${maxAllowed})`);
      console.log(`• Provider Mode   : ${mock ? 'MockBusinessDiscoveryProvider (Offline)' : 'WebSearchDiscoveryProvider (Real Public Sources)'}`);
      console.log(`• Safety DRY_RUN  : ${safetyControls.isDryRun()}\n`);

      const provider = mock ? new MockBusinessDiscoveryProvider() : new WebSearchDiscoveryProvider();
      const businessRepo = new BusinessRepository();

      console.log('--- Initiating Public Source Discovery & Reachability Probes ---\n');

      let summary;
      if (provider instanceof WebSearchDiscoveryProvider) {
        summary = await provider.discoverDetailed({
          niche,
          city,
          country,
          limit: effectiveLimit,
        });
      } else {
        const rawResults = await provider.discover({
          niche,
          city,
          country,
          limit: effectiveLimit,
        });
        summary = {
          requested: requestedLimit,
          discovered: rawResults.length,
          newBusinesses: 0,
          duplicates: 0,
          websitesFound: rawResults.filter((r) => Boolean(r.website)).length,
          noWebsites: rawResults.filter((r) => !r.website).length,
          reachableWebsites: rawResults.filter((r) => Boolean(r.website)).length,
          unreachableWebsites: 0,
          timeoutWebsites: 0,
          blockedWebsites: 0,
          blockedSources: [],
          sourceReports: [
            {
              name: 'MockBusinessDiscoveryProvider',
              type: 'mock',
              status: 'AVAILABLE',
              metrics: {
                requestsCount: 1,
                successfulCount: 1,
                failedCount: 0,
                blockedCount: 0,
                itemsDiscovered: rawResults.length,
              },
            },
          ],
          results: rawResults.map((r) => ({
            ...r,
            officialWebsiteConfidence: r.website ? ('HIGH' as const) : ('UNKNOWN' as const),
            reachability: {
              rawUrl: r.website || '',
              reachable: Boolean(r.website),
              status: r.website ? ('WEBSITE_REACHABLE' as const) : ('NO_WEBSITE_FOUND' as const),
              confidence: r.website ? ('HIGH' as const) : ('UNKNOWN' as const),
            },
          })),
        };
      }

      // Persist / upsert results into SQLite database
      let newCount = 0;
      let dupCount = 0;
      const storedBusinesses = [];

      for (const item of summary.results) {
        const { business, isNew } = await businessRepo.upsertDiscoveredBusiness(
          item,
          item.reachability
        );

        if (isNew) {
          newCount++;
        } else {
          dupCount++;
        }

        storedBusinesses.push({
          id: business.id.substring(0, 8),
          name: business.name,
          category: business.category,
          city: business.city,
          phone: business.phone || 'N/A',
          website: business.website || '(No Website)',
          reachabilityStatus: item.reachability?.status || (business.website ? 'WEBSITE_FOUND' : 'NO_WEBSITE_FOUND'),
          confidence: item.officialWebsiteConfidence || 'UNKNOWN',
          isNew: isNew ? 'YES' : 'DUPLICATE/MERGED',
        });
      }

      summary.newBusinesses = newCount;
      summary.duplicates = dupCount;

      console.log('\n======================================================');
      console.log('              DISCOVERY RUN SUMMARY');
      console.log('======================================================');
      console.log(`• Requested Prospects   : ${summary.requested}`);
      console.log(`• Discovered Total      : ${summary.discovered}`);
      console.log(`• New businesses stored : ${summary.newBusinesses}`);
      console.log(`• Duplicates / Merged   : ${summary.duplicates}`);
      console.log(`• Websites identified   : ${summary.websitesFound}`);
      console.log(`  - Reachable (2xx/3xx) : ${summary.reachableWebsites}`);
      console.log(`  - Unreachable (4xx/5xx): ${summary.unreachableWebsites}`);
      console.log(`  - Timed out           : ${summary.timeoutWebsites}`);
      console.log(`  - Blocked probe (WAF) : ${summary.blockedWebsites}`);
      console.log(`• No website found      : ${summary.noWebsites}`);
      console.log(`• Blocked/failed sources: ${summary.blockedSources.length > 0 ? summary.blockedSources.join(', ') : 'None (All sources healthy)'}\n`);

      if (summary.sourceReports && summary.sourceReports.length > 0) {
        console.log('--- Source Health & Request Budget Telemetry ---');
        console.table(
          summary.sourceReports.map((s) => ({
            Source: s.name,
            Type: s.type,
            Status: s.status,
            Requests: s.metrics.requestsCount,
            Successful: s.metrics.successfulCount,
            Failed: s.metrics.failedCount,
            Blocked: s.metrics.blockedCount,
            Items: s.metrics.itemsDiscovered,
          }))
        );
        console.log('');
      }

      if (storedBusinesses.length > 0) {
        console.log('--- Stored Businesses in SQLite Database ---');
        console.table(storedBusinesses);
        console.log('');
      } else {
        console.log('No businesses found for the given criteria.\n');
      }
    } catch (err) {
      logger.error('Discovery command error', err);
      process.exitCode = 1;
    } finally {
      await disconnectDatabase();
    }
  });

// ------------------------------------------------------------------------------
// Website Auditing Command (Phase 3 Implemented)
// ------------------------------------------------------------------------------
program
  .command('audit')
  .description('Audit website speed, mobile friendliness, SEO, accessibility, UX, and modernization opportunity')
  .option('-u, --url <url>', 'Specific website URL to audit')
  .option('-b, --business-id <id>', 'Audit a specific stored business by ID')
  .option('-l, --limit <number>', 'Number of discovered businesses to audit', '5')
  .option('--dry-run', 'Perform audit without saving results to SQLite database')
  .option('--force', 'Force re-audit ignoring recent cached results')
  .action(async (options) => {
    try {
      const { ComprehensiveWebsiteAuditService } = await import('../modules/auditing/comprehensive-website-audit.service.js');
      const auditService = new ComprehensiveWebsiteAuditService();

      console.log('\n======================================================');
      console.log('       WEBSITE INTELLIGENCE & AUDIT ENGINE (PHASE 3)');
      console.log('======================================================\n');

      if (options.url) {
        console.log(`Auditing Standalone URL: ${options.url}`);
        const result = await auditService.audit(options.url);

        printAuditCard('Target URL', result);
        return;
      }

      if (options.businessId) {
        console.log(`Auditing Business ID: ${options.businessId}`);
        const result = await auditService.auditBusinessById(options.businessId, {
          dryRun: options.dryRun,
          force: options.force,
        });

        const biz = await (await import('../database/index.js')).prisma.business.findUnique({
          where: { id: options.businessId },
        });

        printAuditCard(biz?.name || options.businessId, result);
        return;
      }

      const limit = parseInt(options.limit, 10) || 5;
      console.log(`Auditing up to ${limit} discovered businesses from SQLite database...\n`);

      const results = await auditService.auditDiscoveredBatch(limit, {
        dryRun: options.dryRun,
        force: options.force,
      });

      if (results.length === 0) {
        console.log('No businesses found in SQLite database to audit. Run `npm run cli -- discover` first.\n');
        return;
      }

      for (const item of results) {
        printAuditCard(item.business.name, item.audit);
      }

      console.log(`\n======================================================`);
      console.log(`Successfully completed ${results.length} website audit(s).`);
      console.log(`======================================================\n`);
    } catch (err) {
      logger.error('Audit command error', err);
      process.exitCode = 1;
    } finally {
      await disconnectDatabase();
    }
  });

function printAuditCard(businessName: string, result: import('../types/index.js').ComprehensiveAuditResult): void {
  console.log('------------------------------------------------------');
  console.log(`Business       : ${businessName}`);
  console.log(`Website        : ${result.website || '(No Website Registered)'}`);
  if (result.finalUrl && result.finalUrl !== result.website) {
    console.log(`Final URL      : ${result.finalUrl}`);
  }
  console.log(`Audit Status   : ${result.status} (Confidence: ${result.confidence})`);
  console.log(`Overall Score  : ${result.overallScore}/100`);
  console.log(`Category Breakdown:`);
  console.log(`  • Technical      : ${result.categories.technical}/100 (SSL: ${result.sslValid ? 'YES' : 'NO'})`);
  console.log(`  • Mobile/Resp    : ${result.categories.mobile}/100 (Responsive: ${result.mobileResponsive ? 'YES' : 'NO'})`);
  console.log(`  • Performance    : ${result.categories.performance}/100 (Load: ${result.loadTimeMs}ms)`);
  console.log(`  • SEO            : ${result.categories.seo}/100`);
  console.log(`  • Accessibility  : ${result.categories.accessibility}/100`);
  console.log(`  • UX / Conversion: ${result.categories.ux}/100 (Contact Form: ${result.hasContactForm ? 'YES' : 'NO'})`);
  console.log(`  • Content Quality: ${result.categories.content}/100`);

  console.log(`Mobile App Opp : ${result.mobileAppOpportunity}`);
  if (result.mobileAppReasoning.length > 0) {
    console.log(`  Reason: ${result.mobileAppReasoning[0]}`);
  }

  if (result.opportunityFlags.length > 0) {
    console.log(`Opportunity Flags: [${result.opportunityFlags.join(', ')}]`);
  }

  if (result.topProblems.length > 0) {
    console.log(`Top Problems:`);
    result.topProblems.forEach((p) => console.log(`  - ${p}`));
  } else {
    console.log(`Top Problems   : None detected (Clean audit)`);
  }
  console.log('');
}

// ------------------------------------------------------------------------------
// Lead Scoring & Prioritization Command (Phase 4 Implemented)
// ------------------------------------------------------------------------------
program
  .command('score')
  .description('Calculate Multi-Factor Lead Opportunity Scores and prioritize sales opportunities')
  .option('-b, --business-id <id>', 'Score a specific stored business by ID')
  .option('-l, --limit <number>', 'Number of businesses to score', '10')
  .action(async (options) => {
    try {
      const { LeadScoringService } = await import('../modules/scoring/lead-scoring.service.js');
      const scoringService = new LeadScoringService();

      console.log('\n======================================================');
      console.log('   MULTI-FACTOR LEAD SCORING & PRIORITIZATION (PH4)');
      console.log('======================================================\n');

      if (options.businessId) {
        console.log(`Scoring Business ID: ${options.businessId}`);
        const result = await scoringService.scoreBusinessById(options.businessId);

        const biz = await (await import('../database/index.js')).prisma.business.findUnique({
          where: { id: options.businessId },
        });

        printLeadCard(biz?.name || options.businessId, result);
        return;
      }

      const limit = parseInt(options.limit, 10) || 10;
      console.log(`Scoring up to ${limit} stored businesses in SQLite database...\n`);

      const results = await scoringService.scoreBatch(limit);

      if (results.length === 0) {
        console.log('No businesses found to score. Run `npm run cli -- discover` first.\n');
        return;
      }

      const tableData = results.map((item) => ({
        business: item.business.name.substring(0, 28),
        city: item.business.city,
        website: item.business.website ? 'YES' : 'NONE',
        oppScore: `${item.score.leadOpportunityScore}/100`,
        class: item.score.classification,
        priority: `Rank ${item.score.priorityRank} (${item.score.priority})`,
        service: item.score.recommendedService,
        topSignal: item.score.topOpportunitySignals[0] || 'N/A',
      }));

      console.table(tableData);

      console.log(`\n======================================================`);
      console.log(`Successfully scored and prioritized ${results.length} lead(s).`);
      console.log(`======================================================\n`);
    } catch (err) {
      logger.error('Lead scoring command error', err);
      process.exitCode = 1;
    } finally {
      await disconnectDatabase();
    }
  });

// ------------------------------------------------------------------------------
// Hot Leads Command
// ------------------------------------------------------------------------------
program
  .command('hot-leads')
  .description('Display only high-priority HOT leads sorted by priority rank and opportunity score')
  .option('-l, --limit <number>', 'Maximum hot leads to retrieve', '10')
  .action(async (options) => {
    try {
      const { LeadScoringService } = await import('../modules/scoring/lead-scoring.service.js');
      const scoringService = new LeadScoringService();
      const hotLeads = await scoringService.getHotLeads(parseInt(options.limit, 10) || 10);

      console.log('\n======================================================');
      console.log(`           HOT SALES LEADS (HIGH PRIORITY)`);
      console.log('======================================================\n');

      if (hotLeads.length === 0) {
        console.log('No HOT leads currently identified. Run `npm run cli -- score` to evaluate prospects.\n');
        return;
      }

      const tableData = hotLeads.map((l) => ({
        id: l.id.substring(0, 8),
        business: l.business.name.substring(0, 26),
        city: l.business.city,
        oppScore: `${l.leadOpportunityScore}/100`,
        rank: `Rank ${l.priorityRank} (${l.priority})`,
        confidence: l.confidenceLevel,
        service: l.recommendedService,
        phone: l.business.phone || 'N/A',
      }));

      console.table(tableData);
      console.log('');
    } catch (err) {
      logger.error('Hot leads command error', err);
    } finally {
      await disconnectDatabase();
    }
  });

// ------------------------------------------------------------------------------
// Lead Detail Command
// ------------------------------------------------------------------------------
program
  .command('lead <id>')
  .description('View detailed multi-factor scoring breakdown and sales angle for a lead')
  .action(async (leadId) => {
    try {
      const { prisma } = await import('../database/index.js');
      const lead = await prisma.lead.findFirst({
        where: {
          OR: [{ id: leadId }, { id: { startsWith: leadId } }],
        },
        include: {
          business: {
            include: { audits: { orderBy: { updatedAt: 'desc' }, take: 1 } },
          },
        },
      });

      if (!lead) {
        console.log(`\nLead with ID "${leadId}" not found.\n`);
        return;
      }

      const salesAngle = lead.salesAngle ? JSON.parse(lead.salesAngle) : null;
      const reasoning = lead.reasoning ? JSON.parse(lead.reasoning) : [];
      const audit = lead.business.audits[0];

      console.log('\n======================================================');
      console.log(`         LEAD INTELLIGENCE CARD: ${lead.business.name}`);
      console.log('======================================================\n');
      console.log(`• Lead ID              : ${lead.id}`);
      console.log(`• Business Category    : ${lead.business.category}`);
      console.log(`• Locality             : ${lead.business.city}, ${lead.business.country}`);
      console.log(`• Registered Website   : ${lead.business.website || '(None)'}`);
      console.log(`• Direct Phone         : ${lead.business.phone || 'N/A'}`);
      console.log(`• Website Quality Score: ${audit ? `${audit.score}/100` : '0/100 (No Website)'}`);
      console.log(`• LEAD OPPORTUNITY SCORE: ${lead.leadOpportunityScore}/100 [${lead.classification}]`);
      console.log(`• Priority Ranking     : Rank ${lead.priorityRank} (${lead.priority}) | Confidence: ${lead.confidenceLevel}`);
      console.log(`• Recommended Service  : ${lead.recommendedService}`);

      console.log('\n--- Multi-Factor Score Breakdown ---');
      console.log(`  1. Website Opportunity (30%) : ${lead.websiteOpportunityScore}/100`);
      console.log(`  2. Commercial Potential (20%): ${lead.commercialPotentialScore}/100`);
      console.log(`  3. Contactability (15%)       : ${lead.contactabilityScore}/100`);
      console.log(`  4. Problem Severity (15%)     : ${lead.websiteProblemScore}/100`);
      console.log(`  5. Mobile App Opportunity(10%): ${lead.mobileAppOpportunityScore}/100`);
      console.log(`  6. Data Confidence (10%)      : ${lead.dataConfidenceScore}/100`);

      if (salesAngle) {
        console.log('\n--- Structured Sales Angle ---');
        console.log(`  • Problem   : ${salesAngle.problem}`);
        console.log(`  • Solution  : ${salesAngle.opportunity}`);
        console.log(`  • Service   : ${salesAngle.recommendedService}`);
        console.log(`  • Rationale : ${salesAngle.reason}`);
      }

      if (reasoning.length > 0) {
        console.log('\n--- Scoring Explanations ---');
        reasoning.forEach((r: string) => console.log(`  • ${r}`));
      }
      console.log('');
    } catch (err) {
      logger.error('Lead detail command error', err);
    } finally {
      await disconnectDatabase();
    }
  });

// ------------------------------------------------------------------------------
// Leads Query Command
// ------------------------------------------------------------------------------
program
  .command('leads')
  .description('List scored and prioritized leads stored in the local SQLite database')
  .option('-l, --limit <number>', 'Number of leads to retrieve', '10')
  .action(async (options) => {
    try {
      const { LeadScoringService } = await import('../modules/scoring/lead-scoring.service.js');
      const scoringService = new LeadScoringService();
      const leads = await scoringService.getPrioritizedLeads(parseInt(options.limit, 10) || 10);

      if (leads.length === 0) {
        console.log('\nNo leads found in database. Run `npm run cli -- score` to evaluate discovered businesses.\n');
        return;
      }

      console.log(`\n--- Prioritized Sales Leads (${leads.length}) ---`);
      const formatted = leads.map((l) => ({
        id: l.id.substring(0, 8),
        business: l.business.name.substring(0, 22),
        city: l.business.city,
        oppScore: `${l.leadOpportunityScore}/100`,
        class: l.classification,
        priority: `Rank ${l.priorityRank}`,
        service: l.recommendedService,
        contact: l.primaryContactValue ? `${l.primaryContactValue.substring(0, 24)} [${l.primaryContactType}]` : 'NONE_FOUND',
      }));
      console.table(formatted);
      console.log('');
    } catch (err) {
      logger.error('Failed to list leads', err);
    } finally {
      await disconnectDatabase();
    }
  });

function printLeadCard(businessName: string, result: import('../types/index.js').LeadScoreResult): void {
  console.log('------------------------------------------------------');
  console.log(`Business       : ${businessName}`);
  console.log(`Opportunity    : ${result.leadOpportunityScore}/100 [${result.classification}]`);
  console.log(`Priority       : Rank ${result.priorityRank} (${result.priority}) [Confidence: ${result.confidenceLevel}]`);
  console.log(`Service Match  : ${result.recommendedService}`);
  console.log(`Score Breakdown:`);
  console.log(`  • Website Opportunity  : ${result.breakdown.websiteOpportunity}/100`);
  console.log(`  • Commercial Potential : ${result.breakdown.commercialPotential}/100`);
  console.log(`  • Contactability       : ${result.breakdown.contactability}/100`);
  console.log(`  • Problem Severity     : ${result.breakdown.websiteProblem}/100`);
  console.log(`  • Mobile App Opp       : ${result.breakdown.mobileAppOpportunity}/100`);
  console.log(`  • Data Confidence      : ${result.breakdown.dataConfidence}/100`);
  console.log(`Sales Angle    :`);
  console.log(`  • Problem    : ${result.salesAngle.problem}`);
  console.log(`  • Opportunity: ${result.salesAngle.opportunity}`);
  console.log(`  • Reason     : ${result.salesAngle.reason}`);
  console.log('');
}

// ------------------------------------------------------------------------------
// Contact Discovery Command (Phase 5 Implemented)
// ------------------------------------------------------------------------------
program
  .command('contacts')
  .description('Discover public business emails, phones, and contact pages for prioritized leads')
  .option('-l, --limit <number>', 'Number of leads to process', '10')
  .option('--lead-id <id>', 'Discover contacts for a specific lead ID')
  .option('--business-id <id>', 'Discover contacts for a specific business ID')
  .option('--dry-run', 'Perform discovery without writing to database', false)
  .action(async (options) => {
    try {
      const { ContactDiscoveryService } = await import('../modules/contact-discovery/contact-discovery.service.js');
      const contactService = new ContactDiscoveryService();

      console.log('\n======================================================');
      console.log('      PUBLIC BUSINESS CONTACT DISCOVERY (PH5)');
      console.log('======================================================\n');

      if (options.businessId || options.leadId) {
        let businessId = options.businessId;

        if (options.leadId) {
          const { prisma } = await import('../database/index.js');
          const lead = await prisma.lead.findFirst({
            where: {
              OR: [{ id: options.leadId }, { id: { startsWith: options.leadId } }],
            },
          });
          if (!lead) {
            console.log(`Lead with ID "${options.leadId}" not found.\n`);
            return;
          }
          businessId = lead.businessId;
        }

        const result = await contactService.discoverForBusiness(businessId, { dryRun: options.dryRun });
        printContactCard(result);
        return;
      }

      const limit = parseInt(options.limit, 10) || 10;
      console.log(`Discovering public contacts for up to ${limit} prioritized leads...\n`);

      const results = await contactService.discoverBatch(limit, { dryRun: options.dryRun });

      for (const res of results) {
        printContactCard(res);
      }

      console.log(`======================================================`);
      console.log(`Successfully completed contact discovery for ${results.length} lead(s).`);
      console.log(`======================================================\n`);
    } catch (err) {
      logger.error('Contact discovery command error', err);
      process.exitCode = 1;
    } finally {
      await disconnectDatabase();
    }
  });

function printContactCard(res: import('../types/index.js').ContactDiscoveryResult): void {
  const emailContact = res.contacts.find((c) => c.type === 'EMAIL');
  const phoneContact = res.contacts.find((c) => c.type === 'PHONE');

  console.log('------------------------------------------------------');
  console.log(`Business       : ${res.businessName}`);
  console.log(`Website        : ${res.website || '(No Website Registered)'}`);
  console.log(`Email          : ${emailContact ? emailContact.value : 'NONE_FOUND'}`);
  console.log(`Phone          : ${phoneContact ? phoneContact.value : 'NONE_FOUND'}`);
  if (res.primaryContact) {
    console.log(`Contact Type   : ${res.primaryContact.classification} (${res.primaryContact.type})`);
    console.log(`Source         : ${res.primaryContact.sourceType}`);
    console.log(`Confidence     : ${res.primaryContact.confidence}`);
    console.log(`Quality        : ${res.primaryContact.qualityScore}/100`);
  }
  console.log(`Status         : ${res.status}`);
  if (res.pagesVisited.length > 0) {
    console.log(`Pages Visited  : [${res.pagesVisited.join(', ')}]`);
  }
  console.log('');
}

// ------------------------------------------------------------------------------
// Personalization Command (Phase 6 Implemented)
// ------------------------------------------------------------------------------
program
  .command('personalize')
  .description('Generate personalized, evidence-backed outreach drafts without sending emails')
  .option('-l, --limit <number>', 'Number of leads to personalize', '10')
  .option('--lead <id>', 'Personalize a specific lead by ID')
  .option('--hot-only', 'Personalize only HOT leads', false)
  .action(async (options) => {
    try {
      const { PersonalizationService } = await import('../modules/personalization/personalization.service.js');
      const personalizationService = new PersonalizationService();

      console.log('\n======================================================');
      console.log('   AI PERSONALIZATION & OUTREACH CONTENT ENGINE (PH6)');
      console.log('======================================================\n');

      if (options.lead) {
        const { prisma } = await import('../database/index.js');
        const lead = await prisma.lead.findFirst({
          where: {
            OR: [{ id: options.lead }, { id: { startsWith: options.lead } }],
          },
        });
        if (!lead) {
          console.log(`Lead with ID "${options.lead}" not found.\n`);
          return;
        }

        const result = await personalizationService.personalizeLead(lead.id);
        printPersonalizationCard(result);
        return;
      }

      const limit = parseInt(options.limit, 10) || 10;
      console.log(`Generating drafts for up to ${limit} qualified leads (Hot Only: ${options.hotOnly ? 'YES' : 'NO'})...\n`);

      const results = await personalizationService.personalizeBatch({
        limit,
        hotOnly: options.hotOnly,
      });

      if (results.length === 0) {
        console.log('No qualified leads found for personalization. Run `npm run cli -- score` first.\n');
        return;
      }

      for (const res of results) {
        printPersonalizationCard(res);
      }

      console.log(`======================================================`);
      console.log(`Successfully generated personalized drafts for ${results.length} lead(s).`);
      console.log(`[SAFETY NOTICE] ZERO emails were sent. Drafts stored in SQLite database.`);
      console.log(`======================================================\n`);
    } catch (err) {
      logger.error('Personalization command error', err);
      process.exitCode = 1;
    } finally {
      await disconnectDatabase();
    }
  });

// ------------------------------------------------------------------------------
// Outreach Drafts List Command
// ------------------------------------------------------------------------------
program
  .command('drafts')
  .description('Display stored outreach drafts with personalization scores and quality checks')
  .option('-l, --limit <number>', 'Number of drafts to retrieve', '15')
  .action(async (options) => {
    try {
      const { OutreachRepository } = await import('../database/repositories/outreach.repository.js');
      const outreachRepo = new OutreachRepository();
      const drafts = await outreachRepo.getAllDrafts(parseInt(options.limit, 10) || 15);

      console.log('\n======================================================');
      console.log('            STORED OUTREACH DRAFTS (PH6)');
      console.log('======================================================\n');

      if (drafts.length === 0) {
        console.log('No drafts found. Run `npm run cli -- personalize` to generate outreach copy.\n');
        return;
      }

      const formatted = drafts.map((d) => ({
        draftId: d.id.substring(0, 8),
        business: d.lead.business.name.substring(0, 22),
        variant: d.variant.replace('VARIANT_', ''),
        subject: d.subject ? d.subject.substring(0, 32) : 'N/A',
        pScore: `${d.personalizationScore}/100`,
        status: d.status,
        contact: d.primaryContactValue ? d.primaryContactValue.substring(0, 24) : 'NONE_FOUND',
      }));

      console.table(formatted);
      console.log('');
    } catch (err) {
      logger.error('Failed to list drafts', err);
    } finally {
      await disconnectDatabase();
    }
  });

// ------------------------------------------------------------------------------
// Draft Detail View Command
// ------------------------------------------------------------------------------
program
  .command('draft <id>')
  .description('Display full details, body copy, evidence, and quality checks for a draft')
  .action(async (draftId) => {
    try {
      const { OutreachRepository } = await import('../database/repositories/outreach.repository.js');
      const outreachRepo = new OutreachRepository();
      const draft = await outreachRepo.getDraftById(draftId);

      if (!draft) {
        console.log(`\nDraft with ID "${draftId}" not found.\n`);
        return;
      }

      const evidence: string[] = draft.sourceEvidence ? JSON.parse(draft.sourceEvidence) : [];
      const warnings: string[] = draft.qualityGuardWarnings ? JSON.parse(draft.qualityGuardWarnings) : [];
      const subjectVariants: string[] = draft.subjectVariants ? JSON.parse(draft.subjectVariants) : [];
      const salesAngle = draft.salesAngle ? JSON.parse(draft.salesAngle) : null;

      console.log('\n======================================================');
      console.log(`        OUTREACH DRAFT: ${draft.lead.business.name}`);
      console.log('======================================================\n');
      console.log(`• Draft ID             : ${draft.id}`);
      console.log(`• Lead ID              : ${draft.leadId}`);
      console.log(`• Variant              : ${draft.variant}`);
      console.log(`• Provider             : ${draft.provider}`);
      console.log(`• Personalization Score: ${draft.personalizationScore}/100 [Confidence: ${draft.confidence}]`);
      console.log(`• Quality Guard Status : ${draft.qualityGuardPassed ? 'PASSED (Clean)' : 'FLAGGED'}`);
      console.log(`• Draft Status         : ${draft.status}`);
      console.log(`• Recipient            : ${draft.primaryContactValue || 'NONE_FOUND'} (${draft.primaryContactType || 'N/A'})`);

      if (subjectVariants.length > 0) {
        console.log('\n--- Subject Line Options ---');
        subjectVariants.forEach((s, idx) => console.log(`  ${idx + 1}. ${s}`));
      }

      if (salesAngle) {
        console.log('\n--- Structured Sales Angle ---');
        console.log(`  • Problem   : ${salesAngle.problem}`);
        console.log(`  • Solution  : ${salesAngle.opportunity}`);
        console.log(`  • Service   : ${salesAngle.recommendedService}`);
        console.log(`  • Rationale : ${salesAngle.businessImpact}`);
      }

      if (evidence.length > 0) {
        console.log('\n--- Supporting Audit Evidence ---');
        evidence.forEach((e) => console.log(`  • ${e}`));
      }

      if (warnings.length > 0) {
        console.log('\n--- Quality Guard Warnings ---');
        warnings.forEach((w) => console.log(`  ⚠️  ${w}`));
      }

      console.log('\n--- Email Draft Body ---');
      console.log(draft.body);
      console.log('\n------------------------------------------------------\n');
    } catch (err) {
      logger.error('Failed to view draft', err);
    } finally {
      await disconnectDatabase();
    }
  });

// ------------------------------------------------------------------------------
// Phase 6.5: Human Review & Hardening Commands
// ------------------------------------------------------------------------------

program
  .command('review-drafts')
  .description('Display drafts pending review with quality bands and validation flags')
  .option('-l, --limit <number>', 'Number of drafts to retrieve', '15')
  .action(async (options) => {
    try {
      const { OutreachRepository } = await import('../database/repositories/outreach.repository.js');
      const outreachRepo = new OutreachRepository();
      const drafts = await outreachRepo.getAllDrafts(parseInt(options.limit, 10) || 15);

      console.log('\n======================================================');
      console.log('       OUTREACH DRAFTS REVIEW DASHBOARD (PH6.5)');
      console.log('======================================================\n');

      if (drafts.length === 0) {
        console.log('No drafts found. Run `npm run cli -- personalize` to generate drafts.\n');
        return;
      }

      const formatted = drafts.map((d) => ({
        draftId: d.id.substring(0, 8),
        business: d.lead.business.name.substring(0, 20),
        variant: d.variant.replace('VARIANT_', ''),
        qScore: `${d.qualityScore}/100`,
        band: d.qualityBand,
        evidence: d.evidenceValid ? 'VALID' : 'INVALID',
        identity: d.identityValid ? 'MATCH' : 'MISMATCH',
        status: d.status,
        recipient: d.primaryContactValue ? d.primaryContactValue.substring(0, 22) : 'NONE_FOUND',
      }));

      console.table(formatted);
      console.log('\nUse `npm run cli -- review-draft <id>` for deep evaluation.');
      console.log('Use `npm run cli -- approve-draft <id>` to approve a specific draft.\n');
    } catch (err) {
      logger.error('Failed to review drafts', err);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('review-draft <id>')
  .description('Inspect full draft intelligence card, quality band, evidence, and gate decision')
  .action(async (draftId) => {
    try {
      const { OutreachGateService } = await import('../modules/personalization/hardening/outreach-gate.service.js');
      const { OutreachRepository } = await import('../database/repositories/outreach.repository.js');
      const gateService = new OutreachGateService();
      const outreachRepo = new OutreachRepository();

      const draft = await outreachRepo.getDraftById(draftId);
      if (!draft) {
        console.log(`\nDraft with ID "${draftId}" not found.\n`);
        return;
      }

      const gate = await gateService.evaluateDraft(draft.id);
      const evidence: string[] = draft.sourceEvidence ? JSON.parse(draft.sourceEvidence) : [];
      const salesAngle = draft.salesAngle ? JSON.parse(draft.salesAngle) : null;
      const subjectVariants: string[] = draft.subjectVariants ? JSON.parse(draft.subjectVariants) : [];

      console.log('\n======================================================');
      console.log(`      OUTREACH REVIEW: ${draft.lead.business.name}`);
      console.log('======================================================\n');
      console.log(`• Draft ID          : ${draft.id}`);
      console.log(`• Business Name     : ${draft.lead.business.name}`);
      console.log(`• Website           : ${draft.lead.business.website || '(No Website)'}`);
      console.log(`• Contact Recipient : ${draft.primaryContactValue || 'NONE_FOUND'} (${draft.primaryContactType || 'N/A'})`);
      console.log(`• Lead Opp Score    : ${draft.lead.leadOpportunityScore}/100 [Class: ${draft.lead.classification}, Rank: ${draft.lead.priorityRank}]`);
      console.log(`• Recommended Svc   : ${draft.lead.recommendedService}`);
      console.log(`• Quality Score     : ${gate.score}/100 [Band: ${gate.qualityBand}]`);
      console.log(`• Evidence Valid    : ${gate.evidenceValid ? 'YES (Verified Against Audit)' : 'NO (Contains Unsupported Assertions)'}`);
      console.log(`• Identity Valid    : ${gate.identityValid ? 'YES (Domain & Record Match)' : 'NO (Mismatch)'}`);
      console.log(`• Suppression Status: ${gate.isSuppressed ? 'SUPPRESSED (Blocked from Outreach)' : 'CLEAN (Not Suppressed)'}`);
      console.log(`• Current Status    : ${draft.status}`);
      console.log(`• Gate Allowed      : ${gate.allowed ? 'YES (READY_TO_SEND)' : 'NO (Blocked / Requires Human Action)'}`);

      if (salesAngle) {
        console.log('\n--- Structured Sales Angle ---');
        console.log(`  • Problem   : ${salesAngle.problem}`);
        console.log(`  • Solution  : ${salesAngle.opportunity}`);
        console.log(`  • Service   : ${salesAngle.recommendedService}`);
        console.log(`  • Rationale : ${salesAngle.businessImpact}`);
      }

      if (evidence.length > 0) {
        console.log('\n--- Supporting Audit Evidence ---');
        evidence.forEach((e) => console.log(`  • ${e}`));
      }

      if (gate.reasons.length > 0) {
        console.log('\n--- Gate Blocking Reasons ---');
        gate.reasons.forEach((r) => console.log(`  ❌  ${r}`));
      }

      if (gate.warnings.length > 0) {
        console.log('\n--- Warnings & Advisories ---');
        gate.warnings.forEach((w) => console.log(`  ⚠️  ${w}`));
      }

      if (subjectVariants.length > 0) {
        console.log('\n--- Subject Options ---');
        subjectVariants.forEach((s, idx) => console.log(`  ${idx + 1}. ${s}`));
      }

      console.log('\n--- Email Body Copy ---');
      console.log(draft.body);
      console.log('\n------------------------------------------------------');
      console.log(`To approve this draft:  npm run cli -- approve-draft ${draft.id}`);
      console.log(`To reject this draft:   npm run cli -- reject-draft ${draft.id} --reason "Reason"`);
      console.log('------------------------------------------------------\n');
    } catch (err) {
      logger.error('Failed to review draft', err);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('approve-draft <id>')
  .description('Explicitly approve a specific draft and transition it to READY_TO_SEND')
  .option('-u, --user <name>', 'Operator identifier', 'HUMAN_OPERATOR')
  .action(async (draftId, options) => {
    try {
      const { OutreachGateService } = await import('../modules/personalization/hardening/outreach-gate.service.js');
      const { OutreachRepository } = await import('../database/repositories/outreach.repository.js');
      const gateService = new OutreachGateService();
      const outreachRepo = new OutreachRepository();

      const draft = await outreachRepo.getDraftById(draftId);
      if (!draft) {
        console.log(`\nDraft with ID "${draftId}" not found.\n`);
        return;
      }

      const result = await gateService.approveDraft(draft.id, options.user);

      console.log('\n======================================================');
      console.log('            HUMAN APPROVAL GATE DECISION');
      console.log('======================================================\n');
      console.log(`• Draft ID : ${draft.id}`);
      console.log(`• Business : ${draft.lead.business.name}`);
      console.log(`• Result   : ${result.success ? 'APPROVED' : 'BLOCKED'}`);
      console.log(`• Status   : ${result.status}`);
      console.log(`• Details  : ${result.message}\n`);

      if (!result.success && result.gateResult?.reasons.length > 0) {
        console.log('Gate Blocking Reasons:');
        result.gateResult.reasons.forEach((r) => console.log(`  ❌ ${r}`));
        console.log('');
      }
    } catch (err) {
      logger.error('Failed to approve draft', err);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('reject-draft <id>')
  .description('Explicitly reject a specific draft and record reason')
  .option('-r, --reason <reason>', 'Rejection reason', 'Manual rejection by operator')
  .option('-u, --user <name>', 'Operator identifier', 'HUMAN_OPERATOR')
  .action(async (draftId, options) => {
    try {
      const { OutreachGateService } = await import('../modules/personalization/hardening/outreach-gate.service.js');
      const { OutreachRepository } = await import('../database/repositories/outreach.repository.js');
      const gateService = new OutreachGateService();
      const outreachRepo = new OutreachRepository();

      const draft = await outreachRepo.getDraftById(draftId);
      if (!draft) {
        console.log(`\nDraft with ID "${draftId}" not found.\n`);
        return;
      }

      const result = await gateService.rejectDraft(draft.id, options.reason, options.user);

      console.log('\n======================================================');
      console.log('           DRAFT REJECTION RECORDED');
      console.log('======================================================\n');
      console.log(`• Draft ID : ${draft.id}`);
      console.log(`• Business : ${draft.lead.business.name}`);
      console.log(`• Status   : ${result.status}`);
      console.log(`• Reason   : "${options.reason}"\n`);
    } catch (err) {
      logger.error('Failed to reject draft', err);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('suppress <target>')
  .description('Add an email, domain, phone, or business to persistent suppression list')
  .option('-t, --type <type>', 'Target type: EMAIL, DOMAIN, PHONE, BUSINESS', 'EMAIL')
  .option('-r, --reason <reason>', 'Reason: USER_REQUESTED, UNSUBSCRIBED, DO_NOT_CONTACT, MANUAL_BLOCK', 'DO_NOT_CONTACT')
  .option('-n, --notes <notes>', 'Optional context notes')
  .action(async (target, options) => {
    try {
      const { SuppressionRepository } = await import('../database/repositories/suppression.repository.js');
      const suppressionRepo = new SuppressionRepository();

      const validTypes = ['EMAIL', 'DOMAIN', 'PHONE', 'BUSINESS'];
      const targetType = options.type.toUpperCase();
      if (!validTypes.includes(targetType)) {
        console.log(`Invalid target type "${options.type}". Must be one of: ${validTypes.join(', ')}.\n`);
        return;
      }

      const entry = await suppressionRepo.addSuppression({
        targetValue: target,
        targetType: targetType as any,
        reason: options.reason as any,
        notes: options.notes,
        createdBy: 'CLI_OPERATOR',
      });

      console.log('\n======================================================');
      console.log('          PERSISTENT SUPPRESSION ADDED');
      console.log('======================================================\n');
      console.log(`• Target : ${entry.targetValue} (${entry.targetType})`);
      console.log(`• Reason : ${entry.reason}`);
      console.log(`• Notes  : ${entry.notes || 'None'}`);
      console.log(`• Added  : ${entry.createdAt.toISOString()}\n`);
    } catch (err) {
      logger.error('Failed to add suppression', err);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('suppression-list')
  .description('Display all active suppression list entries')
  .option('-l, --limit <number>', 'Max entries to list', '50')
  .action(async (options) => {
    try {
      const { SuppressionRepository } = await import('../database/repositories/suppression.repository.js');
      const suppressionRepo = new SuppressionRepository();
      const list = await suppressionRepo.getAllSuppressions(parseInt(options.limit, 10) || 50);

      console.log('\n======================================================');
      console.log('           ACTIVE SUPPRESSION ENTRIES (PH6.5)');
      console.log('======================================================\n');

      if (list.length === 0) {
        console.log('No suppression entries registered.\n');
        return;
      }

      const formatted = list.map((s) => ({
        id: s.id.substring(0, 8),
        type: s.targetType,
        target: s.targetValue.substring(0, 30),
        reason: s.reason,
        createdBy: s.createdBy,
        date: s.createdAt.toISOString().split('T')[0],
      }));

      console.table(formatted);
      console.log('');
    } catch (err) {
      logger.error('Failed to list suppressions', err);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('outreach-status')
  .description('Display outreach gate health, suppression stats, cooldowns, and safety kill switches')
  .action(async () => {
    try {
      const { config } = await import('../config/env.js');
      const { prisma } = await import('../database/index.js');

      const totalDrafts = await prisma.outreach.count();
      const readyToSend = await prisma.outreach.count({ where: { status: 'READY_TO_SEND' } });
      const reviewRequired = await prisma.outreach.count({ where: { status: 'REVIEW_REQUIRED' } });
      const rejected = await prisma.outreach.count({ where: { status: 'REJECTED' } });
      const suppressedDrafts = await prisma.outreach.count({ where: { status: 'SUPPRESSED' } });
      const staleDrafts = await prisma.outreach.count({ where: { status: 'STALE' } });
      const totalSuppressions = await prisma.suppression.count();

      console.log('\n======================================================');
      console.log('     OUTREACH QUALITY & COMPLIANCE GATE STATUS');
      console.log('======================================================\n');
      console.log('--- Global Safety Kill Switches ---');
      console.log(`• OUTREACH_ENABLED            : ${config.OUTREACH_ENABLED} (Global Send Lock)`);
      console.log(`• DRY_RUN                     : ${config.DRY_RUN} (Safe Simulation Mode)`);
      console.log(`• MAX_EMAILS_PER_RUN          : ${config.MAX_EMAILS_PER_RUN}`);
      console.log(`• MAX_EMAILS_PER_DAY          : ${config.MAX_EMAILS_PER_DAY}`);
      console.log(`• OUTREACH_MIN_DELAY_MS       : ${config.OUTREACH_MIN_DELAY_MS}ms`);
      console.log(`• OUTREACH_COOLDOWN_MS        : ${config.OUTREACH_COOLDOWN_MS}ms`);
      console.log(`• BUSINESS_COOLDOWN_DAYS      : ${config.OUTREACH_BUSINESS_COOLDOWN_DAYS} days`);
      console.log(`• CONTACT_COOLDOWN_DAYS       : ${config.OUTREACH_CONTACT_COOLDOWN_DAYS} days`);
      console.log(`• DRAFT_EXPIRATION_DAYS       : ${config.OUTREACH_DRAFT_EXPIRATION_DAYS} days\n`);

      console.log('--- Pipeline Draft Counts ---');
      console.log(`• Total Stored Drafts         : ${totalDrafts}`);
      console.log(`• REVIEW_REQUIRED             : ${reviewRequired}`);
      console.log(`• READY_TO_SEND (Approved)    : ${readyToSend}`);
      console.log(`• REJECTED                    : ${rejected}`);
      console.log(`• SUPPRESSED                  : ${suppressedDrafts}`);
      console.log(`• STALE                       : ${staleDrafts}`);
      console.log(`• Active Suppression Entries  : ${totalSuppressions}\n`);
    } catch (err) {
      logger.error('Failed to get outreach status', err);
    } finally {
      await disconnectDatabase();
    }
  });

// ------------------------------------------------------------------------------
// Phase 7: Controlled Outreach Execution Commands
// ------------------------------------------------------------------------------

program
  .command('send')
  .description('Deliver human-approved READY_TO_SEND outreach drafts through safety gate')
  .option('-l, --limit <number>', 'Number of drafts to deliver (clamped by MAX_EMAILS_PER_RUN)', '5')
  .option('--dry-run', 'Run delivery in simulated mode (no network requests)', true)
  .action(async (options) => {
    try {
      const { OutreachExecutionService } = await import('../modules/outreach/execution/outreach-execution.service.js');
      const executionService = new OutreachExecutionService();

      console.log('\n======================================================');
      console.log('      CONTROLLED OUTREACH EXECUTION ENGINE (PH7)');
      console.log('======================================================\n');
      console.log(`• Provider Mode        : ${executionService.getProviderName()}`);
      console.log(`• DRY_RUN Simulation   : ${options.dryRun ? 'YES (No emails will be sent)' : 'NO'}`);
      console.log(`• Requested Limit      : ${options.limit}\n`);

      const summary = await executionService.executeBatch({
        limit: parseInt(options.limit, 10) || 5,
        dryRun: options.dryRun,
      });

      console.log('\n======================================================');
      console.log('               EXECUTION BATCH SUMMARY');
      console.log('======================================================\n');
      console.log(`• Total Eligible Drafts: ${summary.totalEligible}`);
      console.log(`• Dispatches Attempted : ${summary.attempted}`);
      console.log(`• Successfully Sent    : ${summary.sent} ${summary.dryRun ? '(SIMULATED ONLY)' : '(REAL DELIVERIES)'}`);
      console.log(`• Delivery Failures    : ${summary.failed}`);
      console.log(`• Skipped (Gate/Claim) : ${summary.skipped}`);
      console.log(`• Mode                 : ${summary.dryRun ? 'DRY_RUN (SAFE SIMULATION)' : 'LIVE OUTREACH'}\n`);

      if (summary.results.length > 0) {
        const formatted = summary.results.map((r) => ({
          status: r.status,
          provider: r.providerName,
          messageId: r.messageId ? r.messageId.substring(0, 24) : 'N/A',
          error: r.error ? r.error.substring(0, 30) : 'None',
          timestamp: r.attemptedAt.toISOString().split('T')[1].substring(0, 8),
        }));
        console.table(formatted);
        console.log('');
      }

      if (summary.dryRun) {
        console.log('[SAFETY NOTICE] DRY RUN COMPLETED — ZERO REAL EMAILS DELIVERED.\n');
      }
    } catch (err) {
      logger.error('Outreach execution failed', err);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('send-preview <id>')
  .description('Comprehensive pre-send inspection verifying final gate decision and limits')
  .action(async (draftId) => {
    try {
      const { OutreachExecutionService } = await import('../modules/outreach/execution/outreach-execution.service.js');
      const executionService = new OutreachExecutionService();

      const preview = await executionService.previewSend(draftId);
      const draft = preview.draft;

      console.log('\n======================================================');
      console.log(`      PRE-SEND INSPECTION: ${draft.lead.business.name}`);
      console.log('======================================================\n');
      console.log(`• Draft ID          : ${draft.id}`);
      console.log(`• Business Name     : ${draft.lead.business.name}`);
      console.log(`• Recipient         : ${draft.primaryContactValue || 'NONE_FOUND'} (${draft.primaryContactType || 'N/A'})`);
      console.log(`• Quality Score     : ${draft.qualityScore}/100 [Band: ${draft.qualityBand}]`);
      console.log(`• Current Status    : ${draft.status}`);
      console.log(`• Final Pre-Send Gate: ${preview.gateResult.allowed ? 'PASSED' : 'BLOCKED'}`);
      console.log(`• Final Result      : ${preview.sendable ? '✔ SENDABLE' : '❌ BLOCKED'}\n`);

      console.log('--- Daily & Batch Quota Checks ---');
      console.log(`• Daily Volume Sent : ${preview.limits.dailySent}/${preview.limits.dailyMax}`);
      console.log(`• Run Batch Max     : ${preview.limits.runMax}`);
      console.log(`• Cooldown Window   : ${preview.limits.cooldownDays} days`);
      console.log(`• OUTREACH_ENABLED  : ${preview.limits.outreachEnabled}`);
      console.log(`• DRY_RUN           : ${preview.limits.dryRun}\n`);

      if (preview.reasons.length > 0) {
        console.log('--- Send Blocking Reasons ---');
        preview.reasons.forEach((r) => console.log(`  ❌  ${r}`));
        console.log('');
      }

      if (preview.warnings.length > 0) {
        console.log('--- Pre-Flight Advisories ---');
        preview.warnings.forEach((w) => console.log(`  ⚠️  ${w}`));
        console.log('');
      }

      console.log('--- Approved Message Content ---');
      console.log(`Subject: ${draft.subject}`);
      console.log(`\n${draft.body}\n`);
      console.log('------------------------------------------------------\n');
    } catch (err) {
      logger.error('Failed to preview send', err);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('send-status')
  .description('Display real-time quota telemetry and provider availability')
  .action(async () => {
    try {
      const { OutreachExecutionService } = await import('../modules/outreach/execution/outreach-execution.service.js');
      const { OutreachRepository } = await import('../database/repositories/outreach.repository.js');
      const executionService = new OutreachExecutionService();
      const outreachRepo = new OutreachRepository();

      const readyToSend = await outreachRepo.getReadyToSendDrafts(100);
      const dailySent = await outreachRepo.getDailySentCount();

      console.log('\n======================================================');
      console.log('      OUTREACH EXECUTION TELEMETRY & STATUS');
      console.log('======================================================\n');
      console.log(`• Provider Name       : ${executionService.getProviderName()}`);
      console.log(`• OUTREACH_ENABLED    : ${config.OUTREACH_ENABLED} (Global Send Lock)`);
      console.log(`• DRY_RUN             : ${config.DRY_RUN} (Safe Simulation Mode)`);
      console.log(`• Ready to Send Drafts: ${readyToSend.length} draft(s) awaiting delivery`);
      console.log(`• Daily Delivered     : ${dailySent}/${config.MAX_EMAILS_PER_DAY} allowed per day`);
      console.log(`• Per-Run Limit       : ${config.MAX_EMAILS_PER_RUN} emails max per batch`);
      console.log(`• Inter-Send Delay    : ${config.OUTREACH_MIN_DELAY_MS}ms sequential spacing\n`);
    } catch (err) {
      logger.error('Failed to get send status', err);
    } finally {
      await disconnectDatabase();
    }
  });

function printPersonalizationCard(res: import('../types/index.js').PersonalizationResult): void {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('LEAD INTELLIGENCE CARD');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Business       : ${res.businessName}`);
  console.log(`Primary Contact: ${res.primaryContactValue || 'NONE_FOUND'} (${res.primaryContactType || 'N/A'})`);
  console.log(`Service Match  : ${res.salesAngle.recommendedService}`);
  console.log(`Primary Problem: ${res.salesAngle.problem}`);
  console.log(`P-Score        : ${res.overallPersonalizationScore}/100 [Confidence: ${res.salesAngle.confidence}]`);

  if (res.salesAngle.evidence.length > 0) {
    console.log('Evidence:');
    res.salesAngle.evidence.slice(0, 3).forEach((e) => console.log(`  • ${e}`));
  }

  console.log('\nGenerated Variants:');
  res.variants.forEach((v) => {
    console.log(`  - [${v.variant}] Status: ${v.status} | Score: ${v.personalizationScore}/100 | Subject: "${v.subject}"`);
  });
  console.log('');
}

// ------------------------------------------------------------------------------
// Follow-ups Command (Stub)
// ------------------------------------------------------------------------------
program
  .command('followups')
  .description('Manage and check scheduled automated follow-up sequences')
  .action(() => {
    console.log('\n[INFO] Follow-ups automation module not implemented yet — planned for Phase 8.\n');
  });

// ------------------------------------------------------------------------------
// Stats / Analytics Command
// ------------------------------------------------------------------------------
program
  .command('stats')
  .description('Display aggregate pipeline analytics and conversion metrics from the database')
  .action(async () => {
    try {
      const stats = await analyticsService.getPipelineMetrics();
      console.log('\n======================================================');
      console.log('           LEAD PIPELINE ANALYTICS SUMMARY');
      console.log('======================================================\n');
      console.log(`• Total Businesses Stored  : ${stats.totalBusinesses}`);
      console.log(`• Total Audits Completed   : ${stats.totalAudits}`);
      console.log(`• Total Leads Generated    : ${stats.totalLeads}`);
      console.log(`• Qualified Leads          : ${stats.qualifiedLeads} (${stats.opportunityRatePct}% qualification rate)`);
      console.log(`• Disqualified Leads       : ${stats.disqualifiedLeads}`);
      console.log(`• Discovered Contacts      : ${stats.totalContacts}`);
      console.log(`• Outreach Drafts Created  : ${stats.totalOutreachDrafts}`);
      console.log(`• Outreach Sent (Real)     : ${stats.totalOutreachSent}`);
      console.log(`• Follow-ups Scheduled     : ${stats.totalFollowUps}`);
      console.log(`• Inbound Replies Logged   : ${stats.totalReplies}`);
      console.log(`• Positive Replies         : ${stats.positiveReplies}\n`);
    } catch (err) {
      logger.error('Failed to compute analytics', err);
    } finally {
      await disconnectDatabase();
    }
  });

// ------------------------------------------------------------------------------
// Phase 8: Discovery Analytics & Market Yield Reporting
// ------------------------------------------------------------------------------
program
  .command('discovery-stats')
  .description('Display detailed discovery yield, website availability, and lead qualification statistics')
  .option('--country <country>', 'Filter by country (e.g. US, Canada, UK, Australia, Pakistan)')
  .option('--city <city>', 'Filter by city (e.g. Dallas, London, Toronto, Lahore)')
  .option('-n, --niche <niche>', 'Filter by commercial niche (e.g. Dentist, HVAC, Restaurant)')
  .action(async (options) => {
    try {
      const { discoveryAnalyticsService } = await import('../modules/discovery/discovery-analytics.service.js');
      const stats = await discoveryAnalyticsService.getDiscoveryStats({
        country: options.country,
        city: options.city,
        niche: options.niche,
      });

      console.log('\n======================================================================');
      console.log('         DISCOVERY COVERAGE & COMMERCIAL YIELD ANALYTICS');
      console.log('======================================================================\n');

      console.log(`• Total Discovered Businesses : ${stats.totalDiscovered}`);
      console.log(`• Businesses with Websites    : ${stats.withWebsite} (${stats.websiteAvailabilityRate}% website rate)`);
      console.log(`• Businesses without Websites : ${stats.noWebsite}`);
      console.log(`• Total Leads Scored          : ${stats.totalLeadsScored}`);
      console.log(`  - HOT Leads (Rank 1 / Urgent): ${stats.hotLeads}`);
      console.log(`  - WARM Leads (Rank 3-4)     : ${stats.warmLeads}`);
      console.log(`  - COLD / Disqualified Leads : ${stats.coldLeads + stats.disqualifiedLeads}`);
      console.log(`• Commercial Qualification Rate : ${stats.qualificationRate}%`);
      console.log(`• Total Contacts Extracted    : ${stats.totalContactsDiscovered}`);
      console.log(`  - Direct Email Contacts     : ${stats.emailContacts}`);
      console.log(`  - Direct Phone Numbers      : ${stats.phoneContacts}`);
      console.log(`  - Contact Form Webpages     : ${stats.formContacts}`);
      console.log(`• Contact Availability Rate    : ${stats.contactAvailabilityRate}%\n`);

      if (stats.marketBreakdown.length > 0) {
        console.log('----------------------------------------------------------------------');
        console.log('MARKET & NICHE BREAKDOWN:');
        console.log('----------------------------------------------------------------------');
        console.log(
          'Market / City'.padEnd(25) +
          'Niche'.padEnd(16) +
          'Total'.padEnd(8) +
          'Web%'.padEnd(8) +
          'HOT'.padEnd(6) +
          'WARM'.padEnd(6) +
          'Phone'.padEnd(8) +
          'Email'.padEnd(8) +
          'Qual%'
        );
        console.log(''.padEnd(95, '-'));

        for (const m of stats.marketBreakdown) {
          console.log(
            m.market.slice(0, 23).padEnd(25) +
            m.niche.slice(0, 14).padEnd(16) +
            String(m.totalDiscovered).padEnd(8) +
            `${m.websiteRate}%`.padEnd(8) +
            String(m.hotLeads).padEnd(6) +
            String(m.warmLeads).padEnd(6) +
            String(m.phoneAvailable).padEnd(8) +
            String(m.emailsFound).padEnd(8) +
            `${m.qualificationRate}%`
          );
        }
        console.log('\n');
      } else {
        console.log('No market discovery records found matching the filter criteria.\n');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to compute discovery analytics', msg);
    } finally {
      await disconnectDatabase();
    }
  });

// ------------------------------------------------------------------------------
// Phase 8: Market Batch Discovery Command
// ------------------------------------------------------------------------------
program
  .command('discover-market')
  .description('Run controlled multi-niche discovery across target city and market')
  .requiredOption('-c, --city <city>', 'Target city (e.g. Dallas, Toronto, London, Sydney, Lahore)')
  .option('--country <country>', 'Target country or code (US, CA, GB, AU, PK)', 'US')
  .option('--state <state>', 'State or Province (e.g. TX, ON, NSW, Punjab)')
  .option('-n, --niche <niches>', 'Comma-separated list of niches (e.g. dentist,hvac,plumber)', 'dentist')
  .option('-l, --limit <number>', 'Prospects per niche (clamped to MAX_ITEMS_PER_RUN)', '5')
  .option('--mock', 'Run in mock mode for offline testing', false)
  .action(async (options) => {
    try {
      const { getMarketProfile } = await import('../config/markets.js');
      const { BusinessRepository } = await import('../database/repositories/business.repository.js');
      const { getPrismaClient } = await import('../database/client.js');

      const market = getMarketProfile(options.country);
      const niches = options.niche.split(',').map((s: string) => s.trim()).filter(Boolean);
      const requestedLimit = parseInt(options.limit, 10) || 5;

      const policy = safetyControls.getPolicy();
      const clampedLimit = Math.min(requestedLimit, policy.maxItemsPerRun);

      console.log('\n======================================================================');
      console.log('            PHASE 8 MULTI-NICHE MARKET DISCOVERY');
      console.log('======================================================================\n');
      console.log(`• Target Market : ${options.city}${options.state ? `, ${options.state}` : ''}, ${market.countryName} (${market.countryCode})`);
      console.log(`• Target Niches : ${niches.join(', ')}`);
      console.log(`• Limit / Niche : ${clampedLimit} (Safety Clamped to MAX_ITEMS_PER_RUN: ${policy.maxItemsPerRun})`);
      console.log(`• Mode          : ${options.mock ? 'OFFLINE MOCK' : 'LIVE PUBLIC DISCOVERY'}\n`);

      const db = getPrismaClient();
      const businessRepo = new BusinessRepository(db);
      const provider = options.mock
        ? new MockBusinessDiscoveryProvider()
        : new WebSearchDiscoveryProvider();

      let totalDiscoveredBatch = 0;
      let totalNewBatch = 0;
      let totalDupesBatch = 0;

      for (const niche of niches) {
        console.log(`>>> Discovering: "${niche}" in ${options.city}, ${market.countryName}...`);
        const summary = await (provider as WebSearchDiscoveryProvider).discoverDetailed({
          niche,
          city: options.city,
          country: market.countryCode,
          state: options.state,
          limit: clampedLimit,
        });

        let newForNiche = 0;
        let dupForNiche = 0;

        for (const item of summary.results) {
          const { isNew } = await businessRepo.upsertDiscoveredBusiness(item, item.reachability);
          if (isNew) newForNiche++;
          else dupForNiche++;
        }

        totalDiscoveredBatch += summary.results.length;
        totalNewBatch += newForNiche;
        totalDupesBatch += dupForNiche;

        console.log(`    Found ${summary.results.length} businesses (${newForNiche} new, ${dupForNiche} existing). Websites: ${summary.websitesFound}, No-Web: ${summary.noWebsites}\n`);
      }

      console.log('======================================================================');
      console.log('BATCH DISCOVERY COMPLETE:');
      console.log(`• Total Discovered  : ${totalDiscoveredBatch}`);
      console.log(`• New Registered    : ${totalNewBatch}`);
      console.log(`• Deduplicated      : ${totalDupesBatch}`);
      console.log('======================================================================\n');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Batch market discovery failed', msg);
    } finally {
      await disconnectDatabase();
    }
  });

// ------------------------------------------------------------------------------
// Phase 9: Campaign Management & Conversion Workflow Commands
// ------------------------------------------------------------------------------
program
  .command('campaign-create')
  .description('Create a new target client acquisition campaign')
  .requiredOption('--name <name>', 'Campaign name (e.g. "Dallas Dentists")')
  .option('--country <country>', 'Country code (US, CA, GB, AU, PK)', 'US')
  .option('--state <state>', 'State / Province (e.g. TX, ON, NSW)')
  .requiredOption('-c, --city <city>', 'City name (e.g. Dallas, Toronto, London)')
  .requiredOption('-n, --niche <niche>', 'Target commercial niche (e.g. Dentist, HVAC, Plumber)')
  .option('--target <number>', 'Target qualified businesses goal', '100')
  .option('--min-score <score>', 'Minimum lead score threshold', '60')
  .option('--preferred-service <service>', 'Preferred service angle', 'WEBSITE_REBUILD')
  .option('--max-discovery <max>', 'Maximum businesses to discover per run', '25')
  .option('--max-emails <max>', 'Maximum emails per day', '20')
  .action(async (options) => {
    try {
      const { campaignService } = await import('../modules/campaigns/campaign.service.js');
      const campaign = await campaignService.createCampaign({
        name: options.name,
        country: options.country,
        state: options.state,
        city: options.city,
        niche: options.niche,
        targetBusinesses: parseInt(options.target, 10) || 100,
        minLeadScore: parseFloat(options.minScore) || 60,
        preferredService: options.preferredService,
        maxDiscoveryPerRun: parseInt(options.maxDiscovery, 10) || 25,
        maxEmailsPerDay: parseInt(options.maxEmails, 10) || 20,
      });

      console.log('\n======================================================================');
      console.log('              CAMPAIGN CREATED SUCCESSFULLY');
      console.log('======================================================================\n');
      console.log(`• Campaign ID       : ${campaign.id}`);
      console.log(`• Name              : ${campaign.name}`);
      console.log(`• Market            : ${campaign.city}${campaign.state ? `, ${campaign.state}` : ''}, ${campaign.country}`);
      console.log(`• Niche             : ${campaign.niche}`);
      console.log(`• Target Goal       : ${campaign.targetBusinesses} businesses`);
      console.log(`• Min Lead Score    : ${campaign.minLeadScore}/100`);
      console.log(`• Preferred Service : ${campaign.preferredService}`);
      console.log(`• Run Discovery Cap : ${campaign.maxDiscoveryPerRun} per run`);
      console.log(`• Daily Email Cap   : ${campaign.maxEmailsPerDay} per day\n`);
      console.log(`To run this campaign, execute:`);
      console.log(`npm run cli -- campaign-run ${campaign.id}\n`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to create campaign', msg);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('campaign-list')
  .description('List all active and configured acquisition campaigns')
  .action(async () => {
    try {
      const { campaignService } = await import('../modules/campaigns/campaign.service.js');
      const list = await campaignService.listCampaigns();

      console.log('\n======================================================================');
      console.log('                    CLIENT ACQUISITION CAMPAIGNS');
      console.log('======================================================================\n');

      if (list.length === 0) {
        console.log('No campaigns configured yet. Create one with `npm run cli -- campaign-create`.\n');
        return;
      }

      console.log(
        'ID'.padEnd(38) +
        'Name'.padEnd(25) +
        'Market'.padEnd(20) +
        'Niche'.padEnd(16) +
        'Target'.padEnd(8) +
        'Status'
      );
      console.log(''.padEnd(115, '-'));

      for (const c of list) {
        console.log(
          c.id.padEnd(38) +
          c.name.slice(0, 23).padEnd(25) +
          `${c.city}, ${c.country}`.slice(0, 18).padEnd(20) +
          c.niche.slice(0, 14).padEnd(16) +
          String(c.targetBusinesses).padEnd(8) +
          c.status
        );
      }
      console.log('\n');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to list campaigns', msg);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('campaign-run')
  .description('Execute isolated end-to-end pipeline for a specific campaign')
  .argument('<campaignId>', 'Target Campaign ID or Name')
  .option('--mock', 'Run with offline mock provider', false)
  .option('-l, --limit <number>', 'Override max items for this run')
  .action(async (campaignId, options) => {
    try {
      const { campaignService } = await import('../modules/campaigns/campaign.service.js');
      let targetId = campaignId;

      // If user passed a campaign name instead of UUID
      if (!campaignId.includes('-')) {
        const list = await campaignService.listCampaigns();
        const found = list.find((c) => c.name.toLowerCase() === campaignId.toLowerCase() || c.id.startsWith(campaignId));
        if (found) targetId = found.id;
      }

      console.log(`\n>>> Launching Campaign Run for ID "${targetId}"...\n`);
      const result = await campaignService.runCampaignPipeline(targetId, {
        mock: options.mock,
        maxItems: options.limit ? parseInt(options.limit, 10) : undefined,
      });

      console.log('\n======================================================================');
      console.log('                  CAMPAIGN RUN EXECUTION SUMMARY');
      console.log('======================================================================\n');
      console.log(`• Campaign Name       : ${result.campaignName}`);
      console.log(`• Execution Duration  : ${(result.durationMs / 1000).toFixed(1)}s`);
      console.log(`• Discovered Raw      : ${result.discovered} (${result.newBusinesses} new registered)`);
      console.log(`• Websites Audited    : ${result.audited}`);
      console.log(`• Leads Evaluated     : ${result.leadsScored} (${result.qualifiedLeads} qualified)`);
      console.log(`• Contacts Found      : ${result.contactsFound}`);
      console.log(`• Outreach Drafts     : ${result.draftsGenerated}`);
      console.log(`• Approved Status     : ${result.approvedCount}`);
      console.log(`• Ready to Send       : ${result.readyToSendCount}`);
      console.log(`• Sent Count (Dry-Run): ${result.sentCount}\n`);
      console.log('View complete funnel and pacing report:');
      console.log(`npm run cli -- campaign-report ${result.campaignId}\n`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Campaign run failed', msg);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('campaign-report')
  .description('Display detailed funnel drop-off analytics and target pacing for a campaign')
  .argument('<campaignId>', 'Target Campaign ID')
  .action(async (campaignId) => {
    try {
      const { campaignService } = await import('../modules/campaigns/campaign.service.js');
      let targetId = campaignId;
      if (!campaignId.includes('-')) {
        const list = await campaignService.listCampaigns();
        const found = list.find((c) => c.name.toLowerCase() === campaignId.toLowerCase() || c.id.startsWith(campaignId));
        if (found) targetId = found.id;
      }

      const report = await campaignService.getCampaignReport(targetId);

      console.log('\n======================================================================');
      console.log(`      CAMPAIGN PERFORMANCE & FUNNEL REPORT: ${report.campaign.name.toUpperCase()}`);
      console.log('======================================================================\n');

      console.log(`• Market Target     : ${report.campaign.city}, ${report.campaign.country} - Niche: ${report.campaign.niche}`);
      console.log(`• Target Goal       : ${report.campaign.targetBusinesses} qualified leads`);
      console.log(`• Current Achieved  : ${report.pacing.achieved} leads (${report.pacing.remaining} remaining)`);
      console.log(`• Pacing Run-Rate   : ${report.pacing.currentAvgPerDay} leads/day (Required: ${report.pacing.avgPerDayRequired}/day)`);
      console.log(`• Target Completion : ${report.pacing.projectedCompletionDate ? report.pacing.projectedCompletionDate.toLocaleDateString() : 'N/A'} [${report.pacing.onTrack ? 'ON TRACK' : 'NEEDS ACCELERATION'}]\n`);

      console.log('----------------------------------------------------------------------');
      console.log('STAGE-BY-STAGE CONVERSION FUNNEL:');
      console.log('----------------------------------------------------------------------');
      console.log(
        'Stage'.padEnd(22) +
        'Count'.padEnd(10) +
        'Overall%'.padEnd(12) +
        'Conv%'.padEnd(10) +
        'Drop-off (Lost)'
      );
      console.log(''.padEnd(80, '-'));

      for (const st of report.funnel.stages) {
        const dropText = st.dropOffCount > 0 ? `-${st.dropOffCount} (${st.dropOffPercentage}%)` : '-';
        console.log(
          st.stage.padEnd(22) +
          String(st.count).padEnd(10) +
          `${st.percentage}%`.padEnd(12) +
          `${st.conversionFromPrevious}%`.padEnd(10) +
          dropText
        );
      }

      console.log('\n• Primary Pipeline Bottleneck:');
      console.log(`  ${report.funnel.bottleneckStage} -> ${report.funnel.bottleneckReason}\n`);

      if (report.funnel.contactability) {
        const c = report.funnel.contactability;
        console.log('----------------------------------------------------------------------');
        console.log('CONTACTABILITY BREAKDOWN:');
        console.log('----------------------------------------------------------------------');
        console.log(`• Digital Contactable : ${c.digitalContactable} (${c.digitalContactRate}%) [Email: ${c.emailCount}, Form: ${c.formCount}]`);
        console.log(`• Phone Contactable   : ${c.phoneContactable} (${c.phoneContactRate}%) [Business Phone: ${c.businessPhoneCount}]`);
        console.log(`• Total Contactable   : ${c.totalContactable} (${c.totalContactRate}%)`);
        console.log(`• No Contact Found    : ${c.noContact} (${c.noContactRate}%)\n`);
      }

      console.log('----------------------------------------------------------------------');
      console.log('LEAD TEMPERATURE DISTRIBUTION:');
      console.log('----------------------------------------------------------------------');
      console.log(`• HOT Leads   : ${report.leadTemperatures.hot}`);
      console.log(`• WARM Leads  : ${report.leadTemperatures.warm}`);
      console.log(`• COLD Leads  : ${report.leadTemperatures.cold}`);
      console.log(`• Disqualified: ${report.leadTemperatures.disqualified}\n`);

      console.log('----------------------------------------------------------------------');
      console.log('SERVICE OPPORTUNITY BREAKDOWN:');
      console.log('----------------------------------------------------------------------');
      for (const [svc, count] of Object.entries(report.serviceBreakdown)) {
        console.log(`• ${svc.padEnd(25)}: ${count} prospects`);
      }

      try {
        const { replyTrackingService } = await import('../modules/outreach/reply/reply-tracking.service.js');
        const replies = await replyTrackingService.getRepliesSummary(targetId);
        console.log('\n----------------------------------------------------------------------');
        console.log('INBOUND REPLIES & CONVERSION INTELLIGENCE:');
        console.log('----------------------------------------------------------------------');
        console.log(`• Total Inbound Replies : ${replies.total}`);
        console.log(`• Positive Replies      : ${replies.positive}`);
        console.log(`• Questions / Inquiries : ${replies.question}`);
        console.log(`• Negative Responses    : ${replies.negative}`);
        console.log(`• Unsubscribe Requests  : ${replies.unsubscribe}`);
        console.log(`• Out of Office Auto    : ${replies.outOfOffice}\n`);
      } catch {
        // Safe fallback if reply tracking is clean
      }
      console.log('\n');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to generate campaign report', msg);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('lead-queue')
  .description('Display prioritized commercial lead queue with multi-factor sorting')
  .option('--country <country>', 'Filter by country')
  .option('--state <state>', 'Filter by state / province')
  .option('-c, --city <city>', 'Filter by city')
  .option('-n, --niche <niche>', 'Filter by commercial niche')
  .option('--hot-only', 'Show HOT leads only', false)
  .option('-p, --phone-only', 'Show PHONE_ONLY leads only', false)
  .option('--min-score <score>', 'Minimum lead score threshold')
  .option('-l, --limit <number>', 'Number of leads to display', '15')
  .action(async (options) => {
    try {
      const { queueService } = await import('../modules/campaigns/queue.service.js');
      const items = await queueService.getLeadQueue({
        country: options.country,
        state: options.state,
        city: options.city,
        niche: options.niche,
        hotOnly: options.hotOnly,
        phoneOnly: options.phoneOnly,
        minScore: options.minScore ? parseFloat(options.minScore) : undefined,
        limit: parseInt(options.limit, 10) || 15,
      });

      console.log('\n========================================================================================================');
      console.log('                                      PRIORITIZED LEAD QUEUE');
      console.log('======================================================================\n');

      if (items.length === 0) {
        console.log('No leads found matching the filter criteria.\n');
        return;
      }

      if (options.phoneOnly) {
        console.log('--- PHONE-ONLY ACTION QUEUE & CALL GUIDANCE ---');
        for (let i = 0; i < items.length; i++) {
          const item = items[i]!;
          console.log(`┌── [LEAD #${i + 1}] ${item.businessName} (${item.city}, ${item.country}) ─────────────────────────`);
          console.log(`│ Phone Number       : ${item.phone || 'None listed'}`);
          console.log(`│ Opportunity Score  : ${item.leadScore}/100 [${item.classification}] | Rank: #${item.priorityRank}`);
          console.log(`│ Website Status     : ${item.websiteStatus || (item.website ? 'ACTIVE' : 'NO_WEBSITE')} | Confidence: ${item.nameConfidence || 'HIGH'}`);
          console.log(`│ Problem Detected   : ${item.salesAngleText}`);
          console.log(`│ Suggested Service  : ${item.recommendedService}`);
          console.log(`│ Call Objective     : ${item.suggestedObjective || 'Confirm official web presence and marketing contact'}`);
          console.log(`│ Suggested Opening  : "${item.suggestedOpening || 'Hello, I was checking local services...'}"`);
          console.log(`└──\n`);
        }
      } else {
        console.log(
          'Rank'.padEnd(6) +
          'Business Name'.padEnd(26) +
          'Location'.padEnd(16) +
          'Phone / Contact'.padEnd(20) +
          'Score'.padEnd(8) +
          'Class'.padEnd(8) +
          'Channel'.padEnd(14) +
          'Sales Angle'
        );
        console.log(''.padEnd(120, '-'));

        for (let i = 0; i < items.length; i++) {
          const item = items[i]!;
          const contactStr = item.phone || item.contactValue || 'None';
          console.log(
            `#${i + 1}`.padEnd(6) +
            item.businessName.slice(0, 24).padEnd(26) +
            `${item.city}, ${item.country}`.slice(0, 14).padEnd(16) +
            contactStr.slice(0, 18).padEnd(20) +
            `${item.leadScore}/100`.padEnd(8) +
            item.classification.padEnd(8) +
            item.recommendedChannel.padEnd(14) +
            (item.salesAngleText || item.recommendedService).slice(0, 32)
          );
        }
      }
      console.log('\n');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to load lead queue', msg);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('review-interactive')
  .description('Interactive human review interface for pending outreach drafts')
  .option('--campaign-id <id>', 'Target specific campaign ID')
  .option('--campaign <id>', 'Target specific campaign ID (alias)')
  .option('--country <code>', 'Target country code (e.g. US)')
  .option('-e, --email-only', 'Review verified email candidates only', false)
  .option('--pilot-eligible', 'Enforce strict pilot quality and provenance criteria', false)
  .option('--include-test', 'Include test fixtures in review queue (Default: false)', false)
  .option('-l, --limit <number>', 'Number of business groups to review', '50')
  .action(async (options) => {
    try {
      const { interactiveReviewerService } = await import('../modules/outreach/review/interactive-reviewer.service.js');
      await interactiveReviewerService.startInteractiveCli({
        campaignId: options.campaignId || options.campaign,
        country: options.country,
        emailOnly: Boolean(options.emailOnly),
        pilotEligible: Boolean(options.pilotEligible),
        includeTest: Boolean(options.includeTest),
        limit: parseInt(options.limit, 10) || 50,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed in interactive review', msg);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('pilot-preview')
  .description('Preview controlled live pilot candidates and pre-send safety validation without sending')
  .option('-l, --limit <number>', 'Number of verified email leads to inspect (Max 3)', '3')
  .option('--campaign-id <id>', 'Target specific campaign ID')
  .option('--campaign <id>', 'Target specific campaign ID (alias)')
  .option('--country <code>', 'Pilot country code (default: US)', 'US')
  .action(async (options) => {
    try {
      const { pilotExecutionService } = await import('../modules/outreach/execution/pilot-execution.service.js');
      const campaignId = options.campaignId || options.campaign;
      const pilotCountry = options.country || 'US';
      const preview = await pilotExecutionService.previewPilot(
        parseInt(options.limit, 10) || 3,
        campaignId,
        { pilotCountry }
      );

      console.log('\n========================================================================================================');
      console.log('                                  CONTROLLED LIVE PILOT PREVIEW');
      console.log('========================================================================================================');
      console.log(`  Country: ${pilotCountry}  |  Campaign: ${campaignId || 'ALL'}  |  Limit: ${parseInt(options.limit, 10) || 3}`);
      console.log('========================================================================================================\n');

      if (preview.candidates.length === 0) {
        console.log('No email candidates found in outreach queue.\n');
        if (preview.invalidEmailRejected > 0 || preview.nonUSRejected > 0) {
          console.log(`  Pre-filter rejections: ${preview.invalidEmailRejected} invalid email(s), ${preview.nonUSRejected} non-${pilotCountry} lead(s)\n`);
        }
        return;
      }

      console.log(
        'Rank'.padEnd(6) +
        'Business'.padEnd(22) +
        'Location'.padEnd(16) +
        'Email'.padEnd(28) +
        'Score'.padEnd(8) +
        'Quality'.padEnd(10) +
        'SendState'.padEnd(12) +
        'Approval'.padEnd(14) +
        'Blocking Reason'
      );
      console.log(''.padEnd(140, '-'));

      for (let i = 0; i < preview.candidates.length; i++) {
        const c = preview.candidates[i]!;
        const locationStr = `${c.city || '?'}, ${c.country || '?'}`;
        console.log(
          `#${i + 1}`.padEnd(6) +
          c.businessName.slice(0, 20).padEnd(22) +
          locationStr.slice(0, 14).padEnd(16) +
          c.recipientEmail.slice(0, 26).padEnd(28) +
          `${c.leadScore}/100`.padEnd(8) +
          c.candidateQuality.padEnd(10) +
          c.liveSendState.padEnd(12) +
          c.approvalStatus.slice(0, 12).padEnd(14) +
          (c.blockingReason || 'None (Ready for Pilot)')
        );

        console.log(`\n  --- Candidate #${i + 1} Record Audit ---`);
        console.log(`  Business:               ${c.businessName}`);
        console.log(`  City:                   ${c.city || 'Dallas'}`);
        console.log(`  State:                  ${c.state || 'TX'}`);
        console.log(`  Country:                ${c.country || 'US'}`);
        console.log(`  Niche:                  ${c.niche || 'N/A'}`);
        console.log(`  Campaign Match:         ${c.campaignMatch}`);
        console.log(`  Email:                  ${c.recipientEmail}`);
        console.log(`  Email Syntax:           ${c.emailSyntax}`);
        console.log(`  VERIFIED_PUBLIC:        ${c.isVerifiedPublic ? 'YES' : 'NO'}`);
        console.log(`  Exact Source URL:       ${c.exactSourceUrl}`);
        console.log(`  Email As Found:         ${c.emailAsFound}`);
        console.log(`  Source Context:         ${c.sourceContext}`);
        console.log(`  Verification Timestamp: ${c.verificationTimestamp || 'N/A'}`);
        console.log(`  Business Match:         ${c.businessMatch}`);
        console.log(`  Location Match:         ${c.locationMatch}`);
        console.log(`  Candidate Quality:      ${c.candidateQuality}`);
        console.log(`  Live Send State:        ${c.liveSendState}`);
        console.log(`  Blocking Reasons:       ${c.blockingReason || 'None'}`);
        if (c.provenanceWarning) {
          console.log(`  ⚠ Provenance:           ${c.provenanceWarning}`);
        }
        console.log('  ----------------------------------------\n');
      }

      console.log('\n--------------------------------------------------------------------------------------------------------');
      console.log(`Eligible: ${preview.eligibleCount}  |  Blocked: ${preview.blockedCount}  |  Remaining Daily Capacity: ${preview.remainingDailyCapacity}/3  |  Network Sends: 0`);
      if (preview.invalidEmailRejected > 0 || preview.nonUSRejected > 0 || preview.provenanceWarnings > 0) {
        console.log(`Pre-filter: ${preview.invalidEmailRejected} invalid email(s) rejected  |  ${preview.nonUSRejected} non-${pilotCountry} rejected  |  ${preview.provenanceWarnings} provenance warning(s)`);
      }
      console.log('--------------------------------------------------------------------------------------------------------\n');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed in pilot-preview execution', msg);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('pilot-send')
  .description('Controlled live pilot execution (Max 3 verified email sends)')
  .option('-l, --limit <number>', 'Number of verified email leads to send (Max 3)', '3')
  .option('--confirm', 'Explicit confirmation flag required for pilot execution', false)
  .option('--dry-run', 'Simulate delivery without real email dispatch', false)
  .option('--campaign-id <id>', 'Target specific campaign ID')
  .option('--campaign <id>', 'Target specific campaign ID (alias)')
  .option('--country <code>', 'Pilot country code (default: US)', 'US')
  .action(async (options) => {
    try {
      const { pilotExecutionService } = await import('../modules/outreach/execution/pilot-execution.service.js');
      const report = await pilotExecutionService.executePilot({
        limit: parseInt(options.limit, 10) || 3,
        confirm: options.confirm,
        dryRun: options.dryRun,
        campaignId: options.campaignId || options.campaign,
        pilotCountry: options.country || 'US',
      });

      console.log('\n======================================================================');
      console.log('                 CONTROLLED PILOT EXECUTION REPORT');
      console.log('======================================================================\n');
      console.log(`• Pilot Run ID        : ${report.pilotRunId}`);
      console.log(`• Execution Message   : ${report.message}`);
      console.log(`• Safety Mode         : DRY_RUN=${report.safetyState.dryRun}, OUTREACH_ENABLED=${report.safetyState.outreachEnabled}, LIVE_PILOT=${report.safetyState.livePilotEnabled}`);
      console.log(`• Kill Switch Active  : ${report.safetyState.killSwitchActive ? 'YES (BLOCKED)' : 'NO'}`);
      console.log(`• Candidates Eligible : ${report.totalEligible}`);
      console.log(`• Real Emails Sent    : ${report.sent}`);
      console.log(`• Simulated Sends     : ${report.simulated}`);
      console.log(`• Blocked / Rejected  : ${report.blocked}`);
      console.log(`• Failed Transports   : ${report.failed}`);
      console.log(`• Unknown Results     : ${report.unknown}`);
      console.log(`• Duplicate Blocked   : ${report.duplicateBlocked}`);
      console.log(`• Daily Capacity Left : ${report.remainingDailyCapacity}/3\n`);

      if (report.candidates.length > 0) {
        console.log('PILOT CANDIDATE AUDIT SUMMARY:');
        console.log('----------------------------------------------------------------------');
        for (const c of report.candidates) {
          const statusStr = c.eligible ? 'ELIGIBLE (READY)' : `BLOCKED (${c.blockingReason || 'Validation Failed'})`;
          console.log(`• ${c.businessName.padEnd(28)} | ${c.recipientEmail.padEnd(28)} | ${statusStr}`);
        }
      }
      console.log('\n');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed in pilot-send execution', msg);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('pilot-report')
  .description('Display detailed audit report of pilot execution and recent delivery events')
  .option('-l, --limit <number>', 'Number of recent delivery records to inspect', '10')
  .action(async (options) => {
    try {
      const { pilotExecutionService } = await import('../modules/outreach/execution/pilot-execution.service.js');
      const report = await pilotExecutionService.getPilotReport(parseInt(options.limit, 10) || 10);

      console.log('\n======================================================================');
      console.log('                 CONTROLLED PILOT AUDIT & DELIVERY REPORT');
      console.log('======================================================================\n');
      console.log(`• Sent Today          : ${report.sentToday}/3`);
      console.log(`• Remaining Capacity  : ${report.remainingDailyCapacity}/3`);
      console.log(`• Kill Switch Active  : ${report.killSwitchActive ? 'YES (BLOCKED)' : 'NO'}`);
      console.log(`• Safety Flags        : DRY_RUN=${report.safetyState.dryRun}, OUTREACH_ENABLED=${report.safetyState.outreachEnabled}, LIVE_PILOT=${report.safetyState.livePilotEnabled}\n`);

      console.log('RECENT PILOT DISPATCH AUDIT LOG:');
      console.log('----------------------------------------------------------------------');
      if (report.recentSends.length === 0) {
        console.log('No recent pilot sends recorded.\n');
      } else {
        for (const send of report.recentSends) {
          const modeStr = send.dryRun ? '[SIMULATION]' : '[REAL SMTP]';
          console.log(`┌── [OUTREACH ID: ${send.id}] ${modeStr} ─────────────────────────────────`);
          console.log(`│ Business   : ${send.businessName}`);
          console.log(`│ Recipient  : ${send.recipient}`);
          console.log(`│ Subject    : "${send.subject}"`);
          console.log(`│ Status     : ${send.status} | Sent At: ${send.sentAt ? send.sentAt.toISOString() : 'Pending'}`);
          console.log(`│ Message ID : ${send.providerMessageId || 'N/A'}`);
          console.log(`│ Approver   : ${send.approvedBy || 'HUMAN_OPERATOR'}`);
          console.log(`└──\n`);
        }
      }
      console.log('\n');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to generate pilot report', msg);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('smtp-status')
  .description('Inspect and validate local SMTP configuration without sending network traffic')
  .action(async () => {
    try {
      const { config } = await import('../config/env.js');

      const hostConfigured = Boolean(config.SMTP_HOST && config.SMTP_HOST.trim().length > 0);
      const userConfigured = Boolean(config.SMTP_USER && config.SMTP_USER.trim().length > 0);
      const passConfigured = Boolean(config.SMTP_PASSWORD && config.SMTP_PASSWORD.trim().length > 0);
      const fromNameConfigured = Boolean(config.SMTP_FROM_NAME && config.SMTP_FROM_NAME.trim().length > 0);
      const fromEmailConfigured = Boolean(
        config.SMTP_FROM_EMAIL &&
          config.SMTP_FROM_EMAIL.trim().length > 0 &&
          config.SMTP_FROM_EMAIL.includes('@')
      );

      const isValid =
        hostConfigured && userConfigured && passConfigured && fromEmailConfigured;

      let validLabel = 'NO (MISSING CREDENTIALS)';
      if (isValid) {
        validLabel = 'YES (READY)';
      } else if (!passConfigured && hostConfigured && userConfigured && fromEmailConfigured) {
        validLabel = 'NO (MISSING PASSWORD)';
      }

      console.log('\n======================================================================');
      console.log('                   SMTP CONFIGURATION STATUS AUDIT');
      console.log('======================================================================\n');
      console.log(`SMTP Provider          : SmtpDeliveryProvider`);
      console.log(`Host Configured        : ${hostConfigured ? 'YES' : 'NO'}`);
      console.log(`Port                   : ${config.SMTP_PORT}`);
      console.log(`Secure                 : ${config.SMTP_SECURE ? 'YES' : 'NO'}`);
      console.log(`Username Configured    : ${userConfigured ? 'YES' : 'NO'}`);
      console.log(`Password Configured    : ${passConfigured ? 'YES' : 'NO'}`);
      console.log(`From Name              : ${fromNameConfigured ? config.SMTP_FROM_NAME : 'NO'}`);
      console.log(`From Email             : ${fromEmailConfigured ? config.SMTP_FROM_EMAIL : 'NO'}`);
      console.log(`Configuration Valid    : ${validLabel}`);
      console.log(`Network Send Performed : NO\n`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed in smtp-status check', msg);
    }
  });

program
  .command('review-queue')
  .description('Display pending human review queue with draft previews and quality gates')
  .option('-l, --limit <number>', 'Number of items to inspect', '10')
  .option('--campaign-id <id>', 'Target specific campaign ID')
  .option('--campaign <id>', 'Target specific campaign ID (alias)')
  .option('--country <code>', 'Target country code (e.g. US)')
  .option('-e, --email-only', 'Show verified email candidates only', false)
  .option('--pilot-eligible', 'Enforce strict pilot quality and provenance criteria', false)
  .option('--include-test', 'Include test fixtures in review queue (Default: false)', false)
  .action(async (options) => {
    try {
      const { queueService } = await import('../modules/campaigns/queue.service.js');
      const items = await queueService.getReviewQueue(
        parseInt(options.limit, 10) || 10,
        {
          campaignId: options.campaignId || options.campaign,
          country: options.country,
          emailOnly: Boolean(options.emailOnly),
          pilotEligible: Boolean(options.pilotEligible),
          includeTest: Boolean(options.includeTest),
        }
      );

      console.log('\n======================================================================');
      console.log('                 HUMAN OUTREACH REVIEW QUEUE');
      console.log('======================================================================\n');

      if (items.length === 0) {
        console.log('NO HIGH-CONFIDENCE PILOT CANDIDATES\n');
        return;
      }

      for (const item of items) {
        console.log(`┌── [DRAFT ID: ${item.outreachId}] ───────────────────────────────────────`);
        console.log(`│ Business   : ${item.businessName} (${item.city}) - Website: ${item.website || 'None'}`);
        console.log(`│ Score      : Lead: ${item.leadScore}/100 [${item.classification}] | Website Quality: ${item.websiteQualityScore}/100`);
        console.log(`│ Recipient  : ${item.contactValue || 'None'} (${item.contactType})`);
        console.log(`│ Service    : ${item.recommendedService}`);
        console.log(`│ Sales Angle: ${item.salesAngle}`);
        console.log(`│ Quality    : Score: ${item.qualityScore}/100 [Band: ${item.qualityBand}] | Evidence: ${item.evidenceValid ? 'VALID' : 'INVALID'} | Identity: ${item.identityValid ? 'MATCHED' : 'UNMATCHED'}`);
        console.log(`│ Subject    : "${item.subject}"`);
        console.log(`│ Message    :\n│   "${item.bodyPreview.replace(/\n/g, '\n│   ')}"`);
        console.log(`│ Status     : ${item.status} | Suppression: ${item.isSuppressed ? 'SUPPRESSED' : 'CLEAR'}`);
        console.log(`└── To approve: npm run cli -- approve-draft ${item.outreachId}\n`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to load review queue', msg);
    } finally {
      await disconnectDatabase();
    }
  });

program
  .command('market-intelligence')
  .description('Display cross-market yield and service opportunity demand analytics')
  .action(async () => {
    try {
      const { marketIntelligenceService } = await import('../modules/campaigns/market-intelligence.service.js');
      const markets = await marketIntelligenceService.getMarketPerformance();
      const services = await marketIntelligenceService.getServiceDemandBreakdown();

      console.log('\n======================================================================');
      console.log('                  CROSS-MARKET PERFORMANCE INTELLIGENCE');
      console.log('======================================================================\n');

      console.log(
        'Market / City'.padEnd(25) +
        'Niche'.padEnd(16) +
        'Discovered'.padEnd(12) +
        'Web%'.padEnd(8) +
        'Qual%'.padEnd(8) +
        'Digital%'.padEnd(10) +
        'Phone%'.padEnd(8) +
        'Total%'.padEnd(8) +
        'HOT%'.padEnd(8) +
        'Avg Score'
      );
      console.log(''.padEnd(115, '-'));

      for (const m of markets) {
        console.log(
          m.market.slice(0, 23).padEnd(25) +
          m.niche.slice(0, 14).padEnd(16) +
          String(m.discoveredTotal).padEnd(12) +
          `${m.websiteAvailabilityRate}%`.padEnd(8) +
          `${m.qualificationRate}%`.padEnd(8) +
          `${m.digitalContactRate}%`.padEnd(10) +
          `${m.phoneContactRate}%`.padEnd(8) +
          `${m.contactRate}%`.padEnd(8) +
          `${m.hotRate}%`.padEnd(8) +
          `${m.avgLeadScore}/100`
        );
      }

      console.log('\n----------------------------------------------------------------------');
      console.log('SERVICE OPPORTUNITY DEMAND BREAKDOWN:');
      console.log('----------------------------------------------------------------------');
      console.log(
        'Recommended Service'.padEnd(26) +
        'Total Leads'.padEnd(14) +
        'Avg Score'.padEnd(12) +
        'HOT'.padEnd(8) +
        'WARM'.padEnd(8) +
        'Contactable'
      );
      console.log(''.padEnd(80, '-'));

      for (const s of services) {
        console.log(
          s.service.padEnd(26) +
          String(s.leadCount).padEnd(14) +
          `${s.avgLeadScore}/100`.padEnd(12) +
          String(s.hotCount).padEnd(8) +
          String(s.warmCount).padEnd(8) +
          String(s.contactableCount)
        );
      }
      console.log('\n');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to load market intelligence', msg);
    } finally {
      await disconnectDatabase();
    }
  });

// Execute CLI
program.parse(process.argv);


