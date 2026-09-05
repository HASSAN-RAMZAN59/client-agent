import {
  BusinessDiscoveryProvider,
  BusinessDiscoveryQuery,
  DiscoveredBusinessInput,
  LeadContactChannel,
  DiscoverySourceOutcome,
  DiscoveryAggregateOutcome,
} from '../../types/index.js';
import { DiscoverySource, SourceMetrics } from './discovery-source.interface.js';
import { OsmOverpassDiscoverySource } from './sources/osm-overpass.source.js';
import { DuckDuckGoSearchDiscoverySource } from './sources/duckduckgo-search.source.js';
import { createBusinessMatchKey, extractCanonicalDomain } from './normalizer.js';
import { verifyWebsiteReachability, WebsiteReachabilityResult } from './website-verifier.js';
import { validateBusinessIdentity } from './identity-validator.js';
import { classifyWebsite } from './website-classifier.js';
import { getMarketProfile } from '../../config/markets.js';
import { safetyControls } from '../../config/safety.js';
import { safeSleep } from '../../utils/sleeper.js';
import { logger } from '../../utils/logger.js';

export interface EnhancedDiscoveredBusiness extends DiscoveredBusinessInput {
  reachability?: WebsiteReachabilityResult;
}

export interface SourceReportItem {
  name: string;
  type: string;
  status: string;
  outcome: DiscoverySourceOutcome;
  metrics: SourceMetrics;
}

export interface DiscoveryExecutionSummary {
  market: string;
  niche: string;
  requested: number;
  discovered: number;
  rawDiscovered: number;
  uniqueDiscovered: number;
  newBusinesses: number;
  duplicates: number;
  existingInDb: number;
  addedToCampaign: number;
  alreadyCampaignMembers: number;
  discoveryOutcome: DiscoveryAggregateOutcome;
  discoveryErrorMessage?: string;
  websitesFound: number;
  noWebsites: number;
  reachableWebsites: number;
  unreachableWebsites: number;
  timeoutWebsites: number;
  blockedWebsites: number;
  channelDistribution: {
    websiteLead: number;
    phoneOnlyLead: number;
    emailLead: number;
    contactFormLead: number;
    noContactLead: number;
  };
  blockedSources: string[];
  sourceReports: SourceReportItem[];
  results: EnhancedDiscoveredBusiness[];
}

export class WebSearchDiscoveryProvider implements BusinessDiscoveryProvider {
  public readonly providerName = 'WebSearchDiscoveryProvider';
  private sources: DiscoverySource[] = [];
  private log = logger.child('WebSearchDiscoveryProvider');

  constructor(customSources?: DiscoverySource[]) {
    if (customSources && customSources.length > 0) {
      this.sources = customSources;
    } else {
      this.sources = [
        new OsmOverpassDiscoverySource(),
        new DuckDuckGoSearchDiscoverySource(),
      ];
    }
    this.sources.sort((a, b) => a.priority - b.priority);
  }

  public registerSource(source: DiscoverySource): void {
    this.sources.push(source);
    this.sources.sort((a, b) => a.priority - b.priority);
  }

  public getSources(): ReadonlyArray<DiscoverySource> {
    return this.sources;
  }

  public async discoverDetailed(query: BusinessDiscoveryQuery): Promise<DiscoveryExecutionSummary> {
    const policy = safetyControls.getPolicy();
    const requestedTarget = query.limit || 10;
    const effectiveLimit = Math.min(requestedTarget, policy.maxItemsPerRun);
    const globalMaxRequests = policy.maxSourceRequestPerRun;
    const market = getMarketProfile(query.country);

    if (requestedTarget > policy.maxItemsPerRun) {
      this.log.warn(`Requested limit ${requestedTarget} exceeds MAX_ITEMS_PER_RUN (${policy.maxItemsPerRun}). Clamping to ${effectiveLimit}.`);
    }

    const blockedSources: string[] = [];
    const discoveredCandidates: DiscoveredBusinessInput[] = [];

    const seenNameCityKeys = new Set<string>();
    const seenDomains = new Set<string>();
    let totalRequestsMade = 0;
    let rawDiscoveredCount = 0;

    for (const source of this.sources) {
      if (discoveredCandidates.length >= effectiveLimit) break;
      if (totalRequestsMade >= globalMaxRequests) {
        this.log.warn(`Global discovery request budget exhausted (${globalMaxRequests} requests). Halting source queries.`);
        break;
      }

      if (!source.isAvailable()) {
        blockedSources.push(`${source.name} (${source.status})`);
        continue;
      }

      try {
        const remainingNeeded = effectiveLimit - discoveredCandidates.length;
        const sourceResults = await source.discover({
          ...query,
          country: query.country || market.countryCode,
          limit: remainingNeeded,
        });

        rawDiscoveredCount += sourceResults.length;
        totalRequestsMade += source.getMetrics().requestsCount;

        for (const candidate of sourceResults) {
          if (discoveredCandidates.length >= effectiveLimit) break;

          // 1. Enforce business identity safety
          const identityCheck = validateBusinessIdentity(candidate.name, {
            niche: query.niche,
            city: candidate.city,
            country: candidate.country || market.countryName,
          });
          if (identityCheck.isUnsafe) {
            this.log.info(`Candidate "${candidate.name}" dropped: BUSINESS_IDENTITY_UNSAFE (${identityCheck.reason})`);
            continue;
          }

          // 2. Validate official website vs directory/aggregator
          if (candidate.website) {
            const siteClass = classifyWebsite(candidate.website, candidate.name, candidate.city);
            if (siteClass.type !== 'OFFICIAL_BUSINESS_SITE') {
              if (candidate.source === 'public_search') {
                this.log.info(`Search candidate "${candidate.name}" dropped: URL is ${siteClass.type} (${candidate.website})`);
                continue;
              } else {
                // For non-search sources (e.g. OSM), keep the legitimate business entity but nullify directory URL
                this.log.info(`Candidate "${candidate.name}" website nullified: URL is ${siteClass.type} (${candidate.website})`);
                candidate.website = undefined;
                candidate.officialWebsiteStatus = 'UNVERIFIED';
                candidate.websiteType = siteClass.type;
                candidate.officialWebsiteConfidence = 'LOW';
                candidate.officialWebsiteEvidence = siteClass.evidence;
              }
            } else {
              candidate.officialWebsiteStatus = 'VERIFIED';
              candidate.websiteType = 'OFFICIAL_BUSINESS_SITE';
              candidate.officialWebsiteConfidence = siteClass.confidence;
              candidate.officialWebsiteEvidence = siteClass.evidence;
            }
          }

          const matchKey = createBusinessMatchKey(candidate.name, candidate.city);
          const domain = candidate.website ? extractCanonicalDomain(candidate.website) : undefined;

          // In-memory deduplication across sources during run
          if (seenNameCityKeys.has(matchKey) || (domain && seenDomains.has(domain))) {
            this.log.debug(`Duplicate candidate dropped in memory: ${candidate.name} (${candidate.website || 'No website'})`);
            continue;
          }

          seenNameCityKeys.add(matchKey);
          if (domain) seenDomains.add(domain);

          // Enrich provenance metadata
          candidate.country = candidate.country || market.countryName;
          candidate.marketCode = candidate.marketCode || market.countryCode;

          discoveredCandidates.push(candidate);
        }

        if (!source.isAvailable()) {
          blockedSources.push(`${source.name} (${source.status})`);
        }

        await safeSleep(Math.min(500, policy.sourceMinDelayMs));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`Source ${source.name} execution failed: ${msg}`);
        source.markBlocked(msg, 'ERROR');
        blockedSources.push(`${source.name} (ERROR)`);
      }
    }

    // Reachability and confidence probing
    let websitesFound = 0;
    let noWebsites = 0;
    let reachableWebsites = 0;
    let unreachableWebsites = 0;
    let timeoutWebsites = 0;
    let blockedWebsites = 0;

    let websiteLeadCount = 0;
    let phoneOnlyLeadCount = 0;
    let emailLeadCount = 0;
    let contactFormLeadCount = 0;
    let noContactLeadCount = 0;

    const enhancedResults: EnhancedDiscoveredBusiness[] = [];

    for (const biz of discoveredCandidates) {
      if (!biz.website || biz.website.trim().length === 0) {
        noWebsites++;
        const channel: LeadContactChannel = biz.phone ? 'PHONE_ONLY_LEAD' : 'NO_CONTACT_LEAD';
        if (channel === 'PHONE_ONLY_LEAD') phoneOnlyLeadCount++;
        else noContactLeadCount++;

        enhancedResults.push({
          ...biz,
          website: undefined,
          contactChannel: channel,
          officialWebsiteConfidence: 'UNKNOWN',
          reachability: {
            rawUrl: '',
            reachable: false,
            status: 'NO_WEBSITE_FOUND',
            confidence: 'UNKNOWN',
          },
        });
      } else {
        websitesFound++;
        const reachability = await verifyWebsiteReachability(biz.website, biz.name);

        switch (reachability.status) {
          case 'WEBSITE_REACHABLE':
            reachableWebsites++;
            break;
          case 'WEBSITE_TIMEOUT':
            timeoutWebsites++;
            break;
          case 'WEBSITE_BLOCKED':
            blockedWebsites++;
            break;
          case 'WEBSITE_UNREACHABLE':
          default:
            unreachableWebsites++;
            break;
        }

        // Determine contact channel
        let channel: LeadContactChannel = 'WEBSITE_LEAD';
        if (reachability.status === 'WEBSITE_REACHABLE') {
          channel = 'WEBSITE_LEAD';
          websiteLeadCount++;
        } else if (biz.phone) {
          channel = 'PHONE_ONLY_LEAD';
          phoneOnlyLeadCount++;
        } else {
          channel = 'NO_CONTACT_LEAD';
          noContactLeadCount++;
        }

        enhancedResults.push({
          ...biz,
          website: reachability.finalUrl || biz.website,
          contactChannel: channel,
          officialWebsiteConfidence: reachability.confidence,
          reachability,
        });

        await safeSleep(200);
      }
    }

    const sourceReports: SourceReportItem[] = this.sources.map((s) => {
      let outcome: DiscoverySourceOutcome = 'SUCCESS_EMPTY';
      if (typeof s.getOutcome === 'function') {
        outcome = s.getOutcome();
      } else if (s.status === 'BLOCKED') {
        outcome = 'BLOCKED';
      } else if (s.status === 'DISABLED') {
        outcome = 'DISABLED';
      }

      return {
        name: s.name,
        type: s.type,
        status: s.status || 'AVAILABLE',
        outcome,
        metrics: typeof s.getMetrics === 'function'
          ? s.getMetrics()
          : {
              requestsCount: 0,
              successfulCount: 0,
              failedCount: 0,
              blockedCount: 0,
              itemsDiscovered: 0,
            },
      };
    });

    // Compute aggregate outcome across all enabled discovery sources
    let discoveryOutcome: DiscoveryAggregateOutcome = 'SUCCESS_EMPTY';
    let discoveryErrorMessage: string | undefined;

    const enabledReports = sourceReports.filter((r) => r.status !== 'DISABLED');

    if (enhancedResults.length > 0) {
      discoveryOutcome = 'SUCCESS_WITH_RESULTS';
    } else if (enabledReports.length === 0) {
      discoveryOutcome = 'SUCCESS_EMPTY';
    } else {
      const allFailed = enabledReports.every(
        (r) =>
          r.outcome === 'BLOCKED' ||
          r.outcome === 'TIMEOUT' ||
          r.outcome === 'RATE_LIMITED' ||
          r.outcome === 'NETWORK_ERROR' ||
          r.outcome === 'QUERY_ERROR' ||
          r.outcome === 'LOCATION_RESOLUTION_FAILED' ||
          r.outcome === 'LOCATION_AMBIGUOUS' ||
          r.status === 'BLOCKED' ||
          r.status === 'ERROR'
      );

      const anyFailed = enabledReports.some(
        (r) =>
          r.outcome === 'BLOCKED' ||
          r.outcome === 'TIMEOUT' ||
          r.outcome === 'RATE_LIMITED' ||
          r.outcome === 'NETWORK_ERROR' ||
          r.outcome === 'QUERY_ERROR' ||
          r.outcome === 'LOCATION_RESOLUTION_FAILED' ||
          r.outcome === 'LOCATION_AMBIGUOUS'
      );

      if (allFailed) {
        discoveryOutcome = 'SOURCE_FAILURE';
        discoveryErrorMessage = `All discovery sources failed or were blocked: ${enabledReports.map((r) => `${r.name} (${r.outcome})`).join(', ')}`;
      } else if (anyFailed) {
        discoveryOutcome = 'SOURCE_PARTIAL_FAILURE';
        discoveryErrorMessage = `Partial discovery source failure: ${enabledReports.filter((r) => r.outcome !== 'SUCCESS_EMPTY' && r.outcome !== 'SUCCESS_WITH_RESULTS').map((r) => `${r.name} (${r.outcome})`).join(', ')}`;
      } else {
        discoveryOutcome = 'SUCCESS_EMPTY';
      }
    }

    return {
      market: `${query.city}${query.state ? `, ${query.state}` : ''}, ${market.countryName}`,
      niche: query.niche,
      requested: requestedTarget,
      discovered: enhancedResults.length,
      rawDiscovered: rawDiscoveredCount,
      uniqueDiscovered: discoveredCandidates.length,
      newBusinesses: 0, // Populated after DB upsert
      duplicates: 0,    // Populated after DB upsert
      existingInDb: 0,  // Populated after DB upsert
      addedToCampaign: 0, // Populated after DB upsert
      alreadyCampaignMembers: 0, // Populated after DB upsert
      discoveryOutcome,
      discoveryErrorMessage,
      websitesFound,
      noWebsites,
      reachableWebsites,
      unreachableWebsites,
      timeoutWebsites,
      blockedWebsites,
      channelDistribution: {
        websiteLead: websiteLeadCount,
        phoneOnlyLead: phoneOnlyLeadCount,
        emailLead: emailLeadCount,
        contactFormLead: contactFormLeadCount,
        noContactLead: noContactLeadCount,
      },
      blockedSources,
      sourceReports,
      results: enhancedResults,
    };
  }

  public async discover(query: BusinessDiscoveryQuery): Promise<DiscoveredBusinessInput[]> {
    const summary = await this.discoverDetailed(query);
    return summary.results;
  }
}
