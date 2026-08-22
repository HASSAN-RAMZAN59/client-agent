import {
  BusinessDiscoveryProvider,
  BusinessDiscoveryQuery,
  DiscoveredBusinessInput,
} from '../../types/index.js';
import { DiscoverySource, SourceMetrics } from './discovery-source.interface.js';
import { OsmOverpassDiscoverySource } from './sources/osm-overpass.source.js';
import { DuckDuckGoSearchDiscoverySource } from './sources/duckduckgo-search.source.js';
import { verifyWebsiteReachability, WebsiteReachabilityResult } from './website-verifier.js';
import { createBusinessMatchKey, extractCanonicalDomain } from './normalizer.js';
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
  metrics: SourceMetrics;
}

export interface DiscoveryExecutionSummary {
  requested: number;
  discovered: number;
  newBusinesses: number;
  duplicates: number;
  websitesFound: number;
  noWebsites: number;
  reachableWebsites: number;
  unreachableWebsites: number;
  timeoutWebsites: number;
  blockedWebsites: number;
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

    if (requestedTarget > policy.maxItemsPerRun) {
      this.log.warn(`Requested limit ${requestedTarget} exceeds MAX_ITEMS_PER_RUN (${policy.maxItemsPerRun}). Clamping to ${effectiveLimit}.`);
    }

    const blockedSources: string[] = [];
    const discoveredCandidates: DiscoveredBusinessInput[] = [];

    const seenNameCityKeys = new Set<string>();
    const seenDomains = new Set<string>();
    let totalRequestsMade = 0;

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
          limit: remainingNeeded,
        });

        totalRequestsMade += source.getMetrics().requestsCount;

        for (const candidate of sourceResults) {
          if (discoveredCandidates.length >= effectiveLimit) break;

          const matchKey = createBusinessMatchKey(candidate.name, candidate.city);
          const domain = candidate.website ? extractCanonicalDomain(candidate.website) : undefined;

          // In-memory deduplication across sources during run
          if (seenNameCityKeys.has(matchKey) || (domain && seenDomains.has(domain))) {
            this.log.debug(`Duplicate candidate dropped in memory: ${candidate.name} (${candidate.website || 'No website'})`);
            continue;
          }

          seenNameCityKeys.add(matchKey);
          if (domain) seenDomains.add(domain);

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

    const enhancedResults: EnhancedDiscoveredBusiness[] = [];

    for (const biz of discoveredCandidates) {
      if (!biz.website || biz.website.trim().length === 0) {
        noWebsites++;
        enhancedResults.push({
          ...biz,
          website: undefined,
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

        enhancedResults.push({
          ...biz,
          website: reachability.finalUrl || biz.website,
          officialWebsiteConfidence: reachability.confidence,
          reachability,
        });

        await safeSleep(200);
      }
    }

    const sourceReports: SourceReportItem[] = this.sources.map((s) => ({
      name: s.name,
      type: s.type,
      status: s.status || 'AVAILABLE',
      metrics: typeof s.getMetrics === 'function'
        ? s.getMetrics()
        : {
            requestsCount: 0,
            successfulCount: 0,
            failedCount: 0,
            blockedCount: 0,
            itemsDiscovered: 0,
          },
    }));

    return {
      requested: requestedTarget,
      discovered: enhancedResults.length,
      newBusinesses: 0, // Populated after DB upsert
      duplicates: 0,    // Populated after DB upsert
      websitesFound,
      noWebsites,
      reachableWebsites,
      unreachableWebsites,
      timeoutWebsites,
      blockedWebsites,
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
