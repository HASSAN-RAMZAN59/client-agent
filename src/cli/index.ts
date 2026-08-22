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
// Phase 1 End-to-End Demo Command
// ------------------------------------------------------------------------------
program
  .command('run-demo')
  .description('Execute Phase 1 complete modular pipeline simulation (Dry-Run mode)')
  .option('-n, --niche <niche>', 'Target niche', 'Dentist')
  .option('-c, --city <city>', 'Target city', 'Austin')
  .action(async (options) => {
    try {
      console.log('\n--- Executing Phase 1 Modular Pipeline Simulation ---\n');
      const result = await leadPipelineService.executePipelineDemo({
        niche: options.niche,
        city: options.city,
        limit: 3,
      });

      console.log('\nExecution Summary:');
      console.log(`• Discovered Businesses : ${result.discovered}`);
      console.log(`• Audited Websites      : ${result.audited}`);
      console.log(`• Leads Evaluated       : ${result.leadsGenerated}`);
      console.log(`• Public Contacts Found : ${result.contactsFound}`);
      console.log(`• Email Drafts Created  : ${result.draftsCreated}`);
      console.log(`• Dry-Run Dispatches    : ${result.emailsSimulated} (Simulated only - no emails sent)\n`);
    } catch (err) {
      logger.error('Pipeline demo encountered an error', err);
    } finally {
      await disconnectDatabase();
    }
  });

// Execute CLI
program.parse(process.argv);
