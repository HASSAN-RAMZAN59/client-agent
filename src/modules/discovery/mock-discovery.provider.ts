import {
  BusinessDiscoveryProvider,
  BusinessDiscoveryQuery,
  DiscoveredBusinessInput,
} from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { safetyControls } from '../../config/safety.js';

/**
 * Mock business discovery provider for local development, testing, and Phase 1 demonstrations.
 * In future phases, plug in compliant APIs or public dataset ingestion without altering business logic.
 */
export class MockBusinessDiscoveryProvider implements BusinessDiscoveryProvider {
  public readonly providerName = 'MockBusinessDiscoveryProvider';
  private log = logger.child('Discovery');

  private sampleBusinesses: DiscoveredBusinessInput[] = [
    {
      name: 'Apex Dental Care',
      category: 'Dentist',
      city: 'Austin',
      country: 'US',
      address: '101 Medical Pkwy, Austin, TX',
      phone: '+1-512-555-0199',
      website: 'https://apexdental-mock-example.com',
      source: 'mock_dataset',
      sourceUrl: 'https://example-directory.com/austin/dentists',
    },
    {
      name: 'Lone Star Plumbing Pros',
      category: 'Plumber',
      city: 'Austin',
      country: 'US',
      address: '404 Industrial Blvd, Austin, TX',
      phone: '+1-512-555-0244',
      website: 'https://lonestar-plumbing-mock.com',
      source: 'mock_dataset',
      sourceUrl: 'https://example-directory.com/austin/plumbers',
    },
    {
      name: 'Bluebonnet Cafe & Bakery',
      category: 'Restaurant',
      city: 'Austin',
      country: 'US',
      address: '88 South Congress, Austin, TX',
      phone: '+1-512-555-0377',
      website: '', // Intentionally missing website for website revamp/creation opportunity testing
      source: 'mock_dataset',
      sourceUrl: 'https://example-directory.com/austin/restaurants',
    },
    {
      name: 'Austin Family Law Partners',
      category: 'Legal',
      city: 'Austin',
      country: 'US',
      address: '220 Congress Ave, Austin, TX',
      phone: '+1-512-555-0455',
      website: 'http://austinfamilylaw-mock.org',
      source: 'mock_dataset',
      sourceUrl: 'https://example-directory.com/austin/lawyers',
    },
  ];

  public async discover(query: BusinessDiscoveryQuery): Promise<DiscoveredBusinessInput[]> {
    this.log.info(`Discovering businesses for niche="${query.niche}", city="${query.city}" (Provider: ${this.providerName})`);

    const requestedLimit = query.limit || 10;
    safetyControls.assertAllowedBatchSize(requestedLimit, 'Business Discovery');

    const filtered = this.sampleBusinesses.filter((b) => {
      const matchNiche = query.niche
        ? b.category.toLowerCase().includes(query.niche.toLowerCase())
        : true;
      const matchCity = query.city
        ? b.city.toLowerCase().includes(query.city.toLowerCase())
        : true;
      return matchNiche && matchCity;
    });

    const baseResults = (filtered.length > 0 ? filtered : this.sampleBusinesses).slice(0, requestedLimit);
    const results = baseResults.map((b, idx) => ({
      ...b,
      name: `${b.name} ${query.city || b.city}`,
      city: query.city || b.city,
      country: query.country || b.country,
      category: query.niche || b.category,
      website: b.website ? `https://${b.name.toLowerCase().replace(/[^a-z0-9]/g, '')}-${(query.city || 'local').toLowerCase().replace(/[^a-z0-9]/g, '')}-${idx}.com` : undefined,
    }));
    this.log.info(`Discovered ${results.length} businesses.`);
    return results;
  }

  public async discoverDetailed(query: BusinessDiscoveryQuery): Promise<any> {
    const raw = await this.discover(query);
    const results = raw.map((biz) => ({
      ...biz,
      reachability: {
        rawUrl: biz.website || '',
        reachable: Boolean(biz.website),
        status: biz.website ? 'WEBSITE_REACHABLE' : 'NO_WEBSITE_FOUND',
        confidence: 'HIGH',
      },
    }));

    return {
      market: `${query.city}, ${query.country || 'USA'}`,
      niche: query.niche,
      requested: query.limit || 10,
      discovered: results.length,
      newBusinesses: 0,
      duplicates: 0,
      websitesFound: results.filter((r) => Boolean(r.website)).length,
      noWebsites: results.filter((r) => !r.website).length,
      reachableWebsites: results.filter((r) => Boolean(r.website)).length,
      unreachableWebsites: 0,
      timeoutWebsites: 0,
      blockedWebsites: 0,
      channelDistribution: {
        websiteLead: results.filter((r) => Boolean(r.website)).length,
        phoneOnlyLead: results.filter((r) => !r.website && Boolean(r.phone)).length,
        emailLead: 0,
        contactFormLead: 0,
        noContactLead: results.filter((r) => !r.website && !r.phone).length,
      },
      blockedSources: [],
      sourceReports: [
        {
          name: 'Mock_Dataset',
          type: 'mock',
          status: 'AVAILABLE',
          metrics: {
            requestsCount: 1,
            successfulCount: 1,
            failedCount: 0,
            blockedCount: 0,
            itemsDiscovered: results.length,
          },
        },
      ],
      results,
    };
  }
}

