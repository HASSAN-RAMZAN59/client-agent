import { describe, it, expect, beforeEach } from 'vitest';
import { generateDiscoveryQueries } from '../src/modules/discovery/query-generator.js';
import { isExcludedDirectoryDomain, getAllExcludedDomains } from '../src/modules/discovery/excluded-domains.js';
import { getMarketProfile, COUNTRY_MARKET_PROFILES } from '../src/config/markets.js';
import { WebSearchDiscoveryProvider } from '../src/modules/discovery/web-search-discovery.provider.js';
import { MockBusinessDiscoveryProvider } from '../src/modules/discovery/mock-discovery.provider.js';
import { DiscoveryAnalyticsService } from '../src/modules/discovery/discovery-analytics.service.js';
import { safetyControls } from '../src/config/safety.js';

describe('Phase 8: Discovery Coverage & Lead-Volume Optimization', () => {
  describe('1. Query Generation System', () => {
    it('should generate structured high-intent query variants for a target market and niche', () => {
      const variants = generateDiscoveryQueries({
        niche: 'Dentist',
        city: 'Dallas',
        country: 'US',
        state: 'TX',
        maxQueries: 4,
      });

      expect(variants.length).toBeGreaterThanOrEqual(1);
      expect(variants.length).toBeLessThanOrEqual(4);

      // Verify query intents
      expect(variants.some((v) => v.templateType === 'OFFICIAL_WEBSITE')).toBe(true);
      expect(variants.some((v) => v.query.includes('Dentist') && v.query.includes('Dallas'))).toBe(true);
    });

    it('should respect configured MAX_DISCOVERY_QUERIES_PER_RUN safety limits', () => {
      const policy = safetyControls.getPolicy();
      const variants = generateDiscoveryQueries({
        niche: 'Plumber',
        city: 'Sydney',
        country: 'AU',
        maxQueries: 100, // Attempt to exceed limit
      });

      expect(variants.length).toBeLessThanOrEqual(policy.maxDiscoveryQueriesPerRun);
    });

    it('should prevent duplicate queries within generated variants', () => {
      const variants = generateDiscoveryQueries({
        niche: 'HVAC',
        city: 'Houston',
        country: 'USA',
      });

      const queryStrings = variants.map((v) => v.query);
      const uniqueStrings = new Set(queryStrings);
      expect(queryStrings.length).toBe(uniqueStrings.size);
    });
  });

  describe('2. Maintainable Directory & Aggregator Exclusion Filter', () => {
    it('should accurately exclude known directory and review aggregator domains', () => {
      expect(isExcludedDirectoryDomain('https://www.yelp.com/biz/dallas-dental')).toBe(true);
      expect(isExcludedDirectoryDomain('https://yellowpages.com/search?geo=Dallas')).toBe(true);
      expect(isExcludedDirectoryDomain('https://tripadvisor.com/restaurants-dallas')).toBe(true);
      expect(isExcludedDirectoryDomain('https://pk.placedigger.com/rawalpindi-dealers')).toBe(true);
      expect(isExcludedDirectoryDomain('https://dealer.com.pk/listing/cars')).toBe(true);
      expect(isExcludedDirectoryDomain('https://clutch.co/profile/sample-agency')).toBe(true);
      expect(isExcludedDirectoryDomain('https://localsearch.com.au/find/plumber')).toBe(true);
    });

    it('should permit genuine official local business websites', () => {
      expect(isExcludedDirectoryDomain('https://www.dallasdentalarts.com')).toBe(false);
      expect(isExcludedDirectoryDomain('https://coolcarehvac.com')).toBe(false);
      expect(isExcludedDirectoryDomain('https://sohodental.ca')).toBe(false);
      expect(isExcludedDirectoryDomain('https://localplumbsydney.com.au')).toBe(false);
      expect(isExcludedDirectoryDomain('https://lveno.agency')).toBe(false);
    });

    it('should support dynamic runtime exclusions without code alterations', () => {
      expect(isExcludedDirectoryDomain('https://customdirectory.com/listing', ['customdirectory.com'])).toBe(true);
    });
  });

  describe('3. Multi-Country Market Profiles', () => {
    it('should provide complete country profiles for US, CA, GB, AU, PK', () => {
      const usProfile = getMarketProfile('US');
      expect(usProfile.countryCode).toBe('US');
      expect(usProfile.dialCode).toBe('+1');
      expect(usProfile.primaryTlds).toContain('.com');

      const caProfile = getMarketProfile('Canada');
      expect(caProfile.countryCode).toBe('CA');
      expect(caProfile.primaryTlds).toContain('.ca');

      const gbProfile = getMarketProfile('UK');
      expect(gbProfile.countryCode).toBe('GB');
      expect(gbProfile.dialCode).toBe('+44');
      expect(gbProfile.primaryTlds).toContain('.co.uk');

      const auProfile = getMarketProfile('Australia');
      expect(auProfile.countryCode).toBe('AU');
      expect(auProfile.dialCode).toBe('+61');
      expect(auProfile.primaryTlds).toContain('.com.au');

      const pkProfile = getMarketProfile('Pakistan');
      expect(pkProfile.countryCode).toBe('PK');
      expect(pkProfile.dialCode).toBe('+92');
      expect(pkProfile.primaryTlds).toContain('.pk');
    });

    it('should fallback gracefully to Global profile for unknown country inputs', () => {
      const fallback = getMarketProfile('Atlantis');
      expect(fallback.countryCode).toBe('GLOBAL');
      expect(fallback.primaryTlds.length).toBeGreaterThan(0);
    });
  });

  describe('4. Discovery Channel Classification & No-Website Lead Handling', () => {
    it('should classify businesses with no website as PHONE_ONLY_LEAD if phone exists, or NO_CONTACT_LEAD otherwise', async () => {
      const mockSource: any = {
        name: 'Mock_Source',
        type: 'geodata',
        status: 'AVAILABLE',
        priority: 1,
        isAvailable: () => true,
        getMetrics: () => ({ requestsCount: 1, successfulCount: 1, failedCount: 0, blockedCount: 0, itemsDiscovered: 2 }),
        discover: async () => [
          {
            name: 'Acme Phone Only Repair',
            category: 'HVAC',
            city: 'Dallas',
            phone: '+1 (214) 555-0199',
            website: undefined,
            source: 'mock',
          },
          {
            name: 'Ghost Services LLC',
            category: 'HVAC',
            city: 'Dallas',
            phone: undefined,
            website: undefined,
            source: 'mock',
          },
        ],
      };

      const provider = new WebSearchDiscoveryProvider([mockSource]);
      const summary = await provider.discoverDetailed({
        niche: 'HVAC',
        city: 'Dallas',
        limit: 2,
      });

      expect(summary.discovered).toBe(2);
      expect(summary.channelDistribution.phoneOnlyLead).toBe(1);
      expect(summary.channelDistribution.noContactLead).toBe(1);

      const phoneLead = summary.results.find((r) => r.name === 'Acme Phone Only Repair');
      expect(phoneLead?.contactChannel).toBe('PHONE_ONLY_LEAD');
      expect(phoneLead?.website).toBeUndefined();

      const ghostLead = summary.results.find((r) => r.name === 'Ghost Services LLC');
      expect(ghostLead?.contactChannel).toBe('NO_CONTACT_LEAD');
    });
  });

  describe('5. Discovery Analytics Service', () => {
    it('should compute discovery stats and market breakdowns without throwing', async () => {
      const analytics = new DiscoveryAnalyticsService();
      const stats = await analytics.getDiscoveryStats();

      expect(stats).toBeDefined();
      expect(typeof stats.totalDiscovered).toBe('number');
      expect(typeof stats.websiteAvailabilityRate).toBe('number');
      expect(typeof stats.qualificationRate).toBe('number');
      expect(typeof stats.contactAvailabilityRate).toBe('number');
      expect(Array.isArray(stats.marketBreakdown)).toBe(true);
    });
  });
});
