import { describe, it, expect, beforeEach } from 'vitest';
import { LocationResolver } from '../src/modules/discovery/location/location-resolver.js';
import { OverpassElementCandidate } from '../src/modules/discovery/location/location-resolver.interface.js';
import { OsmOverpassDiscoverySource } from '../src/modules/discovery/sources/osm-overpass.source.js';
import { DuckDuckGoSearchDiscoverySource } from '../src/modules/discovery/sources/duckduckgo-search.source.js';
import { generateDiscoveryQueries } from '../src/modules/discovery/query-generator.js';
import { normalizeCountry, getMarketProfile } from '../src/config/markets.js';
import { WebSearchDiscoveryProvider } from '../src/modules/discovery/web-search-discovery.provider.js';

describe('Global Location-Aware Discovery & Multi-Market Resolution Tests', () => {
  let resolver: LocationResolver;

  beforeEach(() => {
    resolver = new LocationResolver();
  });

  describe('1. Location Normalization & Market Profiles', () => {
    it('should normalize Pakistan country variants to canonical PK', () => {
      expect(normalizeCountry('Pakistan')).toEqual({ code: 'PK', name: 'Pakistan' });
      expect(normalizeCountry('PAKISTAN')).toEqual({ code: 'PK', name: 'Pakistan' });
      expect(normalizeCountry('pk')).toEqual({ code: 'PK', name: 'Pakistan' });
      expect(normalizeCountry('PAK')).toEqual({ code: 'PK', name: 'Pakistan' });
    });

    it('should normalize US country variants to canonical US', () => {
      expect(normalizeCountry('United States')).toEqual({ code: 'US', name: 'United States' });
      expect(normalizeCountry('USA')).toEqual({ code: 'US', name: 'United States' });
      expect(normalizeCountry('US')).toEqual({ code: 'US', name: 'United States' });
    });

    it('should normalize Canada, UK, Australia country variants', () => {
      expect(normalizeCountry('Canada')).toEqual({ code: 'CA', name: 'Canada' });
      expect(normalizeCountry('United Kingdom')).toEqual({ code: 'GB', name: 'United Kingdom' });
      expect(normalizeCountry('UK')).toEqual({ code: 'GB', name: 'United Kingdom' });
      expect(normalizeCountry('Australia')).toEqual({ code: 'AU', name: 'Australia' });
    });

    it('should fall back to GLOBAL profile for unknown or unlisted countries', () => {
      const globalProfile = getMarketProfile('Atlantis');
      expect(globalProfile.countryCode).toBe('GLOBAL');
      expect(globalProfile.countryName).toBe('Global');
      const normalized = normalizeCountry('Atlantis');
      expect(normalized.code).toBe('GLOBAL');
    });
  });

  describe('2. Multi-Market Location Resolution (Deterministic Offline Mocks)', () => {
    it('Level 2/3 Fallback: should resolve Faisalabad, Punjab, Pakistan via city-center radius when no admin boundary exists', async () => {
      // Mock Overpass returning a place=city node for Faisalabad (no administrative area polygon)
      resolver.setQueryExecutor(async (city: string): Promise<OverpassElementCandidate[]> => {
        return [
          {
            type: 'node',
            id: 123456,
            lat: 31.4187,
            lon: 73.0791,
            tags: {
              name: 'Faisalabad',
              'name:en': 'Faisalabad',
              place: 'city',
              'is_in:country': 'Pakistan',
              'is_in:country_code': 'PK',
              'is_in:state': 'Punjab',
              population: '3200000',
            },
          },
        ];
      });

      const res = await resolver.resolveLocation({
        city: 'Faisalabad',
        stateOrProvince: 'Punjab',
        country: 'Pakistan',
      });

      expect(res.status).toBe('RESOLVED_CENTER');
      expect(res.resolutionType).toBe('CENTER_RADIUS');
      expect(res.canonicalCountryCode).toBe('PK');
      expect(res.city).toBe('Faisalabad');
      expect(res.center).toBeDefined();
      expect(res.center?.lat).toBeCloseTo(31.4187, 4);
      expect(res.center?.lon).toBeCloseTo(73.0791, 4);
      expect(res.radiusMeters).toBe(25000);
    });

    it('should resolve Lahore, Punjab, Pakistan via center radius', async () => {
      resolver.setQueryExecutor(async (): Promise<OverpassElementCandidate[]> => [
        {
          type: 'node',
          id: 222333,
          lat: 31.5204,
          lon: 74.3587,
          tags: {
            name: 'Lahore',
            place: 'city',
            'is_in:country_code': 'PK',
            'is_in:state': 'Punjab',
            population: '11100000',
          },
        },
      ]);

      const res = await resolver.resolveLocation({
        city: 'Lahore',
        stateOrProvince: 'Punjab',
        country: 'PK',
      });

      expect(res.status).toBe('RESOLVED_CENTER');
      expect(res.center?.lat).toBeCloseTo(31.5204, 4);
    });

    it('should resolve Karachi, Sindh, Pakistan via center radius', async () => {
      resolver.setQueryExecutor(async (): Promise<OverpassElementCandidate[]> => [
        {
          type: 'node',
          id: 444555,
          lat: 24.8607,
          lon: 67.0011,
          tags: {
            name: 'Karachi',
            place: 'city',
            'is_in:country_code': 'PK',
            'is_in:state': 'Sindh',
            population: '14900000',
          },
        },
      ]);

      const res = await resolver.resolveLocation({
        city: 'Karachi',
        stateOrProvince: 'Sindh',
        country: 'Pakistan',
      });

      expect(res.status).toBe('RESOLVED_CENTER');
      expect(res.center?.lat).toBeCloseTo(24.8607, 4);
    });

    it('Level 1: should resolve Dallas, Texas, US via exact administrative boundary area', async () => {
      resolver.setQueryExecutor(async (): Promise<OverpassElementCandidate[]> => [
        {
          type: 'relation',
          id: 111222,
          tags: {
            name: 'Dallas',
            boundary: 'administrative',
            admin_level: '8',
            'addr:state': 'TX',
            'addr:country': 'US',
          },
        },
      ]);

      const res = await resolver.resolveLocation({
        city: 'Dallas',
        stateOrProvince: 'Texas',
        country: 'US',
      });

      expect(res.status).toBe('RESOLVED_AREA');
      expect(res.resolutionType).toBe('ADMINISTRATIVE_AREA');
      expect(res.areaName).toBe('Dallas');
      expect(res.adminLevel).toBe('8');
      expect(res.canonicalCountryCode).toBe('US');
    });

    it('Level 1: should resolve New York, New York, US via administrative area', async () => {
      resolver.setQueryExecutor(async (): Promise<OverpassElementCandidate[]> => [
        {
          type: 'relation',
          id: 999888,
          tags: {
            name: 'New York',
            boundary: 'administrative',
            admin_level: '5',
            'addr:state': 'NY',
            'addr:country': 'US',
          },
        },
      ]);

      const res = await resolver.resolveLocation({
        city: 'New York',
        stateOrProvince: 'New York',
        country: 'USA',
      });

      expect(res.status).toBe('RESOLVED_AREA');
      expect(res.areaName).toBe('New York');
    });

    it('should resolve Toronto, Ontario, Canada', async () => {
      resolver.setQueryExecutor(async (): Promise<OverpassElementCandidate[]> => [
        {
          type: 'relation',
          id: 777666,
          tags: {
            name: 'Toronto',
            boundary: 'administrative',
            admin_level: '8',
            'is_in:province': 'Ontario',
            'is_in:country_code': 'CA',
          },
        },
      ]);

      const res = await resolver.resolveLocation({
        city: 'Toronto',
        stateOrProvince: 'Ontario',
        country: 'Canada',
      });

      expect(res.status).toBe('RESOLVED_AREA');
      expect(res.canonicalCountryCode).toBe('CA');
    });

    it('should resolve London, England, UK', async () => {
      resolver.setQueryExecutor(async (): Promise<OverpassElementCandidate[]> => [
        {
          type: 'relation',
          id: 555444,
          tags: {
            name: 'London',
            boundary: 'administrative',
            admin_level: '6',
            'is_in:country': 'United Kingdom',
            'is_in:country_code': 'GB',
          },
        },
      ]);

      const res = await resolver.resolveLocation({
        city: 'London',
        stateOrProvince: 'England',
        country: 'UK',
      });

      expect(res.status).toBe('RESOLVED_AREA');
      expect(res.canonicalCountryCode).toBe('GB');
    });

    it('should resolve Sydney, NSW, Australia via center coordinates', async () => {
      resolver.setQueryExecutor(async (): Promise<OverpassElementCandidate[]> => [
        {
          type: 'node',
          id: 333222,
          lat: -33.8688,
          lon: 151.2093,
          tags: {
            name: 'Sydney',
            place: 'city',
            'is_in:state': 'NSW',
            'is_in:country_code': 'AU',
          },
        },
      ]);

      const res = await resolver.resolveLocation({
        city: 'Sydney',
        stateOrProvince: 'NSW',
        country: 'Australia',
      });

      expect(res.status).toBe('RESOLVED_CENTER');
      expect(res.center?.lat).toBeCloseTo(-33.8688, 4);
      expect(res.canonicalCountryCode).toBe('AU');
    });

    it('State Optionality: should resolve city + country without state', async () => {
      resolver.setQueryExecutor(async (): Promise<OverpassElementCandidate[]> => [
        {
          type: 'node',
          id: 101010,
          lat: 48.8566,
          lon: 2.3522,
          tags: {
            name: 'Paris',
            place: 'city',
            'is_in:country': 'France',
            'is_in:country_code': 'FR',
          },
        },
      ]);

      const res = await resolver.resolveLocation({
        city: 'Paris',
        country: 'France',
      });

      expect(res.status).toBe('RESOLVED_CENTER');
      expect(res.city).toBe('Paris');
      expect(res.center?.lat).toBeCloseTo(48.8566, 4);
    });
  });

  describe('3. Disambiguation & Safe Failure Semantics', () => {
    it('Same-Name City Safety: should disambiguate Springfield, IL from Springfield, MA', async () => {
      resolver.setQueryExecutor(async (): Promise<OverpassElementCandidate[]> => [
        {
          type: 'node',
          id: 11,
          lat: 42.1015,
          lon: -72.5898,
          tags: {
            name: 'Springfield',
            place: 'city',
            'addr:state': 'MA',
            'addr:country': 'US',
          },
        },
        {
          type: 'node',
          id: 12,
          lat: 39.7817,
          lon: -89.6501,
          tags: {
            name: 'Springfield',
            place: 'city',
            'addr:state': 'IL',
            'addr:country': 'US',
          },
        },
      ]);

      const res = await resolver.resolveLocation({
        city: 'Springfield',
        stateOrProvince: 'IL',
        country: 'US',
      });

      expect(res.status).toBe('RESOLVED_CENTER');
      expect(res.center?.lat).toBeCloseTo(39.7817, 4);
    });

    it('Ambiguous City Safety: should return LOCATION_AMBIGUOUS if multiple cities match across regions with no disambiguation', async () => {
      resolver.setQueryExecutor(async (): Promise<OverpassElementCandidate[]> => [
        {
          type: 'node',
          id: 21,
          lat: 42.1015,
          lon: -72.5898,
          tags: {
            name: 'Springfield',
            place: 'city',
            'addr:state': 'MA',
            'addr:country': 'US',
          },
        },
        {
          type: 'node',
          id: 22,
          lat: 39.7817,
          lon: -89.6501,
          tags: {
            name: 'Springfield',
            place: 'city',
            'addr:state': 'IL',
            'addr:country': 'US',
          },
        },
      ]);

      // No state provided
      const res = await resolver.resolveLocation({
        city: 'Springfield',
        country: 'US',
      });

      expect(res.status).toBe('LOCATION_AMBIGUOUS');
    });

    it('Non-Existent City Safety: should return LOCATION_RESOLUTION_FAILED if Overpass returns 0 matches', async () => {
      resolver.setQueryExecutor(async (): Promise<OverpassElementCandidate[]> => []);

      const res = await resolver.resolveLocation({
        city: 'NonExistentCityXYZ999',
        country: 'US',
      });

      expect(res.status).toBe('LOCATION_RESOLUTION_FAILED');
    });
  });

  describe('4. Natural Search Query Generation', () => {
    it('should NOT generate compound quotes around city and state', () => {
      const queries = generateDiscoveryQueries({
        niche: 'dentist',
        city: 'Faisalabad',
        state: 'Punjab',
        country: 'Pakistan',
      });

      const text = queries.map((q) => q.query).join(' ');

      // Must NOT contain '"Faisalabad Punjab"' or '"Faisalabad punjab"'
      expect(text).not.toContain('"Faisalabad Punjab"');
      expect(text).not.toContain('"Faisalabad punjab"');

      // Should contain natural unquoted phrases
      expect(queries[0].query).toBe('"dentist" Faisalabad Punjab official website');
      expect(queries[1].query).toBe('"dentist" Faisalabad Pakistan contact');
    });

    it('should format Dallas Texas queries naturally without compound quotes', () => {
      const queries = generateDiscoveryQueries({
        niche: 'HVAC',
        city: 'Dallas',
        state: 'Texas',
        country: 'US',
      });

      const text = queries.map((q) => q.query).join(' ');
      expect(text).not.toContain('"Dallas Texas"');
      expect(text).not.toContain('"Dallas texas"');
      expect(queries[0].query).toBe('"HVAC" Dallas Texas official website');
    });

    it('should handle city + country when state is absent', () => {
      const queries = generateDiscoveryQueries({
        niche: 'dentist',
        city: 'London',
        country: 'United Kingdom',
      });

      expect(queries[0].query).toBe('"dentist" London official website');
      expect(queries[1].query).toBe('"dentist" London United Kingdom contact');
    });
  });

  describe('5. Structured Source Outcomes & Aggregation', () => {
    it('should report LOCATION_RESOLUTION_FAILED when OSM cannot resolve city', async () => {
      const mockResolver = new LocationResolver(async () => []);
      const osm = new OsmOverpassDiscoverySource(undefined, mockResolver);

      const results = await osm.discover({
        niche: 'dentist',
        city: 'GhostTown404',
        country: 'US',
      });

      expect(results).toEqual([]);
      expect(osm.getOutcome()).toBe('LOCATION_RESOLUTION_FAILED');
    });

    it('should report BLOCKED when search engine is deactivated', () => {
      const ddg = new DuckDuckGoSearchDiscoverySource();
      ddg.markBlocked('Captcha encountered', 'BLOCKED');
      expect(ddg.getOutcome()).toBe('BLOCKED');
    });

    it('WebSearchDiscoveryProvider should report SOURCE_FAILURE when all sources fail or are blocked', async () => {
      const mockResolver = new LocationResolver(async () => []);
      const osm = new OsmOverpassDiscoverySource(undefined, mockResolver);
      const ddg = new DuckDuckGoSearchDiscoverySource();
      ddg.markBlocked('Anti-bot block', 'BLOCKED');

      const provider = new WebSearchDiscoveryProvider([osm, ddg]);
      const summary = await provider.discoverDetailed({
        niche: 'dentist',
        city: 'GhostTown404',
        country: 'US',
      });

      expect(summary.discovered).toBe(0);
      expect(summary.discoveryOutcome).toBe('SOURCE_FAILURE');
      expect(summary.discoveryErrorMessage).toContain('LOCATION_RESOLUTION_FAILED');
      expect(summary.discoveryErrorMessage).toContain('BLOCKED');
    });

    it('WebSearchDiscoveryProvider should report SUCCESS_EMPTY when sources run normally but find 0 businesses', async () => {
      // Mock resolver successfully resolves city center
      const mockResolver = new LocationResolver(async () => [
        {
          type: 'node',
          id: 100,
          lat: 30.0,
          lon: 70.0,
          tags: { name: 'SmallTown', place: 'town', 'addr:country': 'PK' },
        },
      ]);
      const osm = new OsmOverpassDiscoverySource(undefined, mockResolver);
      // Disable network requests to force 0 results gracefully
      osm.enabled = false;

      const provider = new WebSearchDiscoveryProvider([osm]);
      const summary = await provider.discoverDetailed({
        niche: 'dentist',
        city: 'SmallTown',
        country: 'PK',
      });

      expect(summary.discovered).toBe(0);
      expect(summary.discoveryOutcome).toBe('SUCCESS_EMPTY');
    });
  });
});
