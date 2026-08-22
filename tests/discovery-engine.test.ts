import { describe, it, expect, afterAll, vi } from 'vitest';
import { getPrismaClient, disconnectDatabase } from '../src/database/client.js';
import { BusinessRepository } from '../src/database/repositories/business.repository.js';
import { WebSearchDiscoveryProvider } from '../src/modules/discovery/web-search-discovery.provider.js';
import { DiscoverySource } from '../src/modules/discovery/discovery-source.interface.js';
import { safetyControls } from '../src/config/safety.js';

describe('Discovery Engine Integration & Deduplication', () => {
  const prisma = getPrismaClient();
  const businessRepo = new BusinessRepository(prisma);

  const testBatchId = Date.now();

  afterAll(async () => {
    await prisma.business.deleteMany({
      where: { name: { contains: `BatchTest ${testBatchId}` } },
    });
    await disconnectDatabase();
  });

  it('should enforce MAX_ITEMS_PER_RUN limit even if user requests more', async () => {
    const mockSource: DiscoverySource = {
      name: 'MockTestStream',
      type: 'mock',
      enabled: true,
      priority: 1,
      status: 'AVAILABLE',
      isAvailable: () => true,
      markBlocked: () => {},
      resetStatus: () => {},
      getMetrics: () => ({
        requestsCount: 1,
        successfulCount: 1,
        failedCount: 0,
        blockedCount: 0,
        itemsDiscovered: 10,
      }),
      resetMetrics: () => {},
      discover: async ({ limit }) => {
        const list = [];
        for (let i = 0; i < (limit || 10); i++) {
          list.push({
            name: `BatchTest ${testBatchId} Item ${i}`,
            category: 'Dentist',
            city: 'Dallas',
            source: 'test_stream',
          });
        }
        return list;
      },
    };

    const provider = new WebSearchDiscoveryProvider([mockSource]);
    const maxAllowed = safetyControls.getPolicy().maxItemsPerRun;

    const summary = await provider.discoverDetailed({
      niche: 'Dentist',
      city: 'Dallas',
      limit: 100, // User requested 100
    });

    expect(summary.requested).toBe(100);
    expect(summary.discovered).toBeLessThanOrEqual(maxAllowed);
  });

  it('should persist businesses without websites with NO_WEBSITE_FOUND status', async () => {
    const bizInput = {
      name: `BatchTest ${testBatchId} NoWebsite Dental`,
      category: 'Dentist',
      city: 'Dallas',
      source: 'test_source',
    };

    const { business, isNew } = await businessRepo.upsertDiscoveredBusiness(bizInput, {
      rawUrl: '',
      reachable: false,
      status: 'NO_WEBSITE_FOUND',
      confidence: 'UNKNOWN',
    });

    expect(isNew).toBe(true);
    expect(business.website).toBeNull();

    // Check associated WebsiteAudit record
    const audit = await prisma.websiteAudit.findFirst({
      where: { businessId: business.id },
    });
    expect(audit).toBeDefined();
    expect(audit?.status).toBe('NO_WEBSITE_FOUND');
    expect(audit?.score).toBe(0.0);
  });

  it('should deduplicate and enrich existing business when found from another source', async () => {
    const bizName = `BatchTest ${testBatchId} Merged Dental`;

    // 1. Initial discovery without phone
    const { business: initial, isNew: isFirstNew } = await businessRepo.upsertDiscoveredBusiness({
      name: bizName,
      category: 'Dentist',
      city: 'Dallas',
      website: 'https://mergeddental.com',
      source: 'source_a',
    });
    expect(isFirstNew).toBe(true);
    expect(initial.phone).toBeNull();

    // 2. Second discovery from another source containing phone and address
    const { business: enriched, isNew: isSecondNew, wasUpdated } = await businessRepo.upsertDiscoveredBusiness({
      name: `  ${bizName} LLC  `, // slight variation
      category: 'Dentist',
      city: 'Dallas',
      website: 'https://www.mergeddental.com/', // slight URL variation
      phone: '+1 214-555-8888',
      address: '500 Elm St',
      source: 'source_b',
    });

    expect(isSecondNew).toBe(false);
    expect(wasUpdated).toBe(true);
    expect(enriched.id).toBe(initial.id);
    expect(enriched.phone).toBe('+1 214-555-8888');
    expect(enriched.address).toBe('500 Elm St');
  });
});
