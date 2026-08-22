import { describe, it, expect, vi, afterEach } from 'vitest';
import { OsmOverpassDiscoverySource } from '../src/modules/discovery/sources/osm-overpass.source.js';
import { DuckDuckGoSearchDiscoverySource } from '../src/modules/discovery/sources/duckduckgo-search.source.js';
import { WebSearchDiscoveryProvider } from '../src/modules/discovery/web-search-discovery.provider.js';
import {
  verifyWebsiteReachability,
  calculateOfficialWebsiteConfidence,
} from '../src/modules/discovery/website-verifier.js';
import { SafetyControls } from '../src/config/safety.js';
import { parseConfig } from '../src/config/env.js';

describe('Phase 2.5 Hardening & Safety Controls', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    SafetyControls.getInstance(parseConfig({ DISCOVERY_OSM_ENABLED: 'true', DISCOVERY_DDG_ENABLED: 'true' }));
  });

  describe('OSM Overpass Safety & User-Agent', () => {
    it('should send configured User-Agent with Overpass queries', async () => {
      let capturedUserAgent: string | undefined;

      global.fetch = vi.fn().mockImplementation(async (_url, init) => {
        const headers = init?.headers as Record<string, string>;
        capturedUserAgent = headers?.['User-Agent'];
        return {
          ok: true,
          status: 200,
          json: async () => ({ elements: [] }),
        } as unknown as Response;
      });

      const source = new OsmOverpassDiscoverySource();
      await source.discover({ niche: 'Dentist', city: 'Dallas', limit: 5 });

      expect(capturedUserAgent).toBeDefined();
      expect(capturedUserAgent).toContain('LeadGenAutomation');
    });

    it('should execute requests sequentially without concurrent race conditions', async () => {
      let concurrentExecutions = 0;
      let maxConcurrent = 0;

      global.fetch = vi.fn().mockImplementation(async () => {
        concurrentExecutions++;
        maxConcurrent = Math.max(maxConcurrent, concurrentExecutions);
        await new Promise((r) => setTimeout(r, 50));
        concurrentExecutions--;
        return {
          ok: true,
          status: 200,
          json: async () => ({ elements: [] }),
        } as unknown as Response;
      });

      const source = new OsmOverpassDiscoverySource();

      // Launch 3 simultaneous discovery calls on the same source instance
      await Promise.all([
        source.discover({ niche: 'Dentist', city: 'Dallas', limit: 2 }),
        source.discover({ niche: 'Dentist', city: 'Dallas', limit: 2 }),
        source.discover({ niche: 'Dentist', city: 'Dallas', limit: 2 }),
      ]);

      expect(maxConcurrent).toBe(1);
    }, 25000);
  });

  describe('Source Kill Switches & Request Budgets', () => {
    it('should deactivate source when kill switch is disabled', () => {
      const customSafety = SafetyControls.getInstance(
        parseConfig({
          DISCOVERY_DDG_ENABLED: 'false',
          DISCOVERY_OSM_ENABLED: 'false',
        })
      );

      expect(customSafety.getPolicy().discoveryDdgEnabled).toBe(false);
      expect(customSafety.getPolicy().discoveryOsmEnabled).toBe(false);

      const ddgSource = new DuckDuckGoSearchDiscoverySource(customSafety.getPolicy());
      const osmSource = new OsmOverpassDiscoverySource(customSafety.getPolicy());

      expect(ddgSource.isAvailable()).toBe(false);
      expect(ddgSource.status).toBe('DISABLED');
      expect(osmSource.isAvailable()).toBe(false);
      expect(osmSource.status).toBe('DISABLED');
    });

    it('should enforce SOURCE_MAX_REQUESTS_PER_RUN budget', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ elements: [] }),
      } as unknown as Response);

      const source = new OsmOverpassDiscoverySource();
      // Simulate exhausting the request budget
      (source as any).metrics.requestsCount = 10;

      const results = await source.discover({ niche: 'Dentist', city: 'Dallas', limit: 5 });
      expect(results).toEqual([]);
    });
  });

  describe('Website Status Classification', () => {
    it('should classify HTTP 200-399 as WEBSITE_REACHABLE', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://dallasdental.com/',
      } as unknown as Response);

      const result = await verifyWebsiteReachability('https://dallasdental.com', 'Dallas Dental');
      expect(result.status).toBe('WEBSITE_REACHABLE');
      expect(result.reachable).toBe(true);
    });

    it('should classify HTTP 403 / 429 as WEBSITE_BLOCKED', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        url: 'https://dallasdental.com/',
      } as unknown as Response);

      const result = await verifyWebsiteReachability('https://dallasdental.com', 'Dallas Dental');
      expect(result.status).toBe('WEBSITE_BLOCKED');
      expect(result.reachable).toBe(false);
    });

    it('should classify connection timeouts as WEBSITE_TIMEOUT', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('The operation was aborted due to timeout'));

      const result = await verifyWebsiteReachability('https://dallasdental.com', 'Dallas Dental');
      expect(result.status).toBe('WEBSITE_TIMEOUT');
      expect(result.reachable).toBe(false);
    });

    it('should classify HTTP 404 / 500 as WEBSITE_UNREACHABLE', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        url: 'https://dallasdental.com/',
      } as unknown as Response);

      const result = await verifyWebsiteReachability('https://dallasdental.com', 'Dallas Dental');
      expect(result.status).toBe('WEBSITE_UNREACHABLE');
      expect(result.reachable).toBe(false);
    });

    it('should classify missing website as NO_WEBSITE_FOUND', async () => {
      const result = await verifyWebsiteReachability('', 'Dallas Dental');
      expect(result.status).toBe('NO_WEBSITE_FOUND');
      expect(result.reachable).toBe(false);
    });
  });

  describe('Official Website Confidence', () => {
    it('should assign HIGH confidence when domain matches business name directly', () => {
      const confidence = calculateOfficialWebsiteConfidence('Dallas Smile Studio', 'https://dallassmilestudio.com');
      expect(confidence).toBe('HIGH');
    });

    it('should assign LOW confidence for social profiles or free hosters', () => {
      const fbConfidence = calculateOfficialWebsiteConfidence('Dallas Smile Studio', 'https://facebook.com/dallassmile');
      expect(fbConfidence).toBe('LOW');

      const wixConfidence = calculateOfficialWebsiteConfidence('Dallas Smile Studio', 'https://dallassmile.wixsite.com/mysite');
      expect(wixConfidence).toBe('LOW');
    });

    it('should assign UNKNOWN for missing URLs', () => {
      expect(calculateOfficialWebsiteConfidence('Dallas Smile Studio', '')).toBe('UNKNOWN');
    });
  });

  describe('Provenance Preservation', () => {
    it('should tag provenance metadata on discovered records', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          elements: [
            {
              type: 'node',
              id: 999,
              tags: {
                name: 'Proven Dental',
                amenity: 'dentist',
                website: 'https://provendental.com',
                phone: '+1 214-555-7777',
              },
            },
          ],
        }),
      } as unknown as Response);

      const source = new OsmOverpassDiscoverySource();
      const results = await source.discover({ niche: 'Dentist', city: 'Dallas', limit: 1 });

      expect(results[0]?.source).toBe('osm_overpass');
      expect(results[0]?.websiteSource).toBe('osm_overpass');
      expect(results[0]?.phoneSource).toBe('osm_overpass');
      expect(results[0]?.officialWebsiteConfidence).toBe('HIGH');
      expect(results[0]?.discoveredAt).toBeInstanceOf(Date);
    });
  });
});
