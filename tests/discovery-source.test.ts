import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OsmOverpassDiscoverySource } from '../src/modules/discovery/sources/osm-overpass.source.js';
import { DuckDuckGoSearchDiscoverySource } from '../src/modules/discovery/sources/duckduckgo-search.source.js';
import { WebSearchDiscoveryProvider } from '../src/modules/discovery/web-search-discovery.provider.js';

describe('Discovery Sources & Failure Handling', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('OsmOverpassDiscoverySource', () => {
    it('should parse valid OpenStreetMap Overpass JSON response', async () => {
      const mockOverpassJson = {
        elements: [
          {
            type: 'node',
            id: 12345,
            tags: {
              name: 'Dallas Smile Studio',
              amenity: 'dentist',
              website: 'https://dallassmilestudio.com',
              phone: '+1 214-555-0144',
              'addr:street': 'Main St',
              'addr:housenumber': '100',
            },
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockOverpassJson,
      } as unknown as Response);

      const source = new OsmOverpassDiscoverySource();
      const results = await source.discover({ niche: 'Dentist', city: 'Dallas', limit: 5 });

      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe('Dallas Smile Studio');
      expect(results[0]?.website).toBe('https://dallassmilestudio.com');
      expect(results[0]?.phone).toBe('+1 214-555-0144');
      expect(results[0]?.address).toBe('100 Main St');
      expect(results[0]?.source).toBe('osm_overpass');
    });

    it('should handle HTTP 429 rate limit and mark source blocked without throwing', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      } as unknown as Response);

      const source = new OsmOverpassDiscoverySource();
      expect(source.isAvailable()).toBe(true);

      const results = await source.discover({ niche: 'Dentist', city: 'Dallas', limit: 5 });

      expect(results).toEqual([]);
      expect(source.isAvailable()).toBe(false);
    });

    it('should handle HTTP 403 forbidden gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      } as unknown as Response);

      const source = new OsmOverpassDiscoverySource();
      const results = await source.discover({ niche: 'Dentist', city: 'Dallas', limit: 5 });

      expect(results).toEqual([]);
      expect(source.isAvailable()).toBe(false);
    });
  });

  describe('DuckDuckGoSearchDiscoverySource', () => {
    it('should parse public search HTML results', async () => {
      const mockHtml = `
        <div class="result">
          <h2 class="result__title">
            <a href="/l/?uddg=https%3A%2F%2Fwww.prestonfamilydentistry.com%2F">Preston Family Dentistry - Dallas, TX</a>
          </h2>
          <div class="result__snippet">
            Family and cosmetic dentistry in North Dallas. Call (214) 555-9876 today.
          </div>
        </div>
      `;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => mockHtml,
      } as unknown as Response);

      const source = new DuckDuckGoSearchDiscoverySource();
      const results = await source.discover({ niche: 'Dentist', city: 'Dallas', limit: 5 });

      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe('Preston Family Dentistry');
      expect(results[0]?.website).toBe('https://www.prestonfamilydentistry.com');
      expect(results[0]?.phone).toBe('(214) 555-9876');
      expect(results[0]?.source).toBe('public_search');
    });

    it('should filter out directories and aggregators like Yelp or YellowPages', async () => {
      const mockHtml = `
        <div class="result">
          <h2 class="result__title">
            <a href="https://www.yelp.com/biz/dallas-dentists">Top 10 Best Dentists in Dallas - Yelp</a>
          </h2>
          <div class="result__snippet">Directory of dentists in Dallas.</div>
        </div>
        <div class="result">
          <h2 class="result__title">
            <a href="/l/?uddg=https%3A%2F%2Fdallascosmeticdentist.com">Dallas Cosmetic Dentistry Office</a>
          </h2>
          <div class="result__snippet">Serving Dallas patients. (214) 555-1122</div>
        </div>
      `;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => mockHtml,
      } as unknown as Response);

      const source = new DuckDuckGoSearchDiscoverySource();
      const results = await source.discover({ niche: 'Dentist', city: 'Dallas', limit: 5 });

      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe('Dallas Cosmetic Dentistry Office');
      expect(results[0]?.website).toBe('https://dallascosmeticdentist.com');
    });
  });

  describe('Multi-Source Fallback Resilience', () => {
    it('should continue to next available source if first source fails or is blocked', async () => {
      const source1 = new OsmOverpassDiscoverySource();
      const source2 = new DuckDuckGoSearchDiscoverySource();

      vi.spyOn(source1, 'discover').mockRejectedValue(new Error('Network connection timeout'));
      vi.spyOn(source2, 'discover').mockResolvedValue([
        {
          name: 'Fallback Dental Care',
          category: 'Dentist',
          city: 'Dallas',
          website: 'https://fallbackdental.com',
          source: 'public_search',
        },
      ]);

      const provider = new WebSearchDiscoveryProvider([source1, source2]);
      const summary = await provider.discoverDetailed({ niche: 'Dentist', city: 'Dallas', limit: 5 });

      expect(summary.discovered).toBe(1);
      expect(summary.results[0]?.name).toBe('Fallback Dental Care');
      expect(summary.blockedSources.some((s) => s.includes('OpenStreetMap_Overpass'))).toBe(true);
    });
  });
});
