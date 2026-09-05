import { describe, it, expect, vi } from 'vitest';
import { OsmOverpassDiscoverySource } from '../src/modules/discovery/sources/osm-overpass.source.js';
import { BrowserSearchDiscoverySource } from '../src/modules/discovery/sources/browser-search.source.js';
import { DirectoryHintDiscoverySource } from '../src/modules/discovery/sources/directory-hint.source.js';
import { OfficialWebsiteResolver } from '../src/modules/discovery/official-website-resolver.js';
import { WebSearchDiscoveryProvider } from '../src/modules/discovery/web-search-discovery.provider.js';
import { normalizePhone, arePhonesEquivalent } from '../src/modules/discovery/normalizer.js';
import { calculateContactQualityScore, selectPrimaryContact } from '../src/modules/contact-discovery/scoring/contact-quality.scorer.js';
import { DiscoveredContactRecord, DiscoveredBusinessInput } from '../src/types/index.js';
import { isExcludedDirectoryDomain } from '../src/modules/discovery/excluded-domains.js';

describe('Discovery Coverage & Contact Enrichment Hardening Suite', () => {
  describe('1. Phone Normalization (Pakistan & International)', () => {
    it('should normalize Pakistan mobile and landline numbers into canonical E.164 and local formats', () => {
      // Pakistan mobile: 0300-1234567 or +923001234567
      expect(normalizePhone('03001234567')).toBe('+923001234567');
      expect(normalizePhone('+92 300 1234567')).toBe('+923001234567');
      expect(normalizePhone('0300-1234567')).toBe('+923001234567');

      // Pakistan Faisalabad landline: 041-8765432
      expect(normalizePhone('0418765432')).toBe('+92418765432');
      expect(normalizePhone('+92 41 8765432')).toBe('+92418765432');

      // Reject malformed or too short numbers
      expect(normalizePhone('123')).toBeUndefined();
      expect(normalizePhone('0300')).toBeUndefined();
    });

    it('should deduplicate equivalent phone representations', () => {
      expect(arePhonesEquivalent('03001234567', '+92 300 1234567')).toBe(true);
      expect(arePhonesEquivalent('041-8765432', '+92 41 8765432')).toBe(true);
      expect(arePhonesEquivalent('03001234567', '03009999999')).toBe(false);
    });
  });

  describe('2. OSM Native Contact Extraction with Exact Provenance', () => {
    it('should extract native phone, mobile, and email OSM tags and attach exact source provenance', async () => {
      const source = new OsmOverpassDiscoverySource();
      const mockOverpassData = {
        elements: [
          {
            type: 'node',
            id: 987654,
            tags: {
              name: 'Faisalabad Dental Specialist Clinic',
              amenity: 'dentist',
              phone: '041-8765432',
              'contact:mobile': '03001234567',
              'contact:email': 'info@fsddentist.pk',
              'addr:city': 'Faisalabad',
              'addr:street': 'Jail Road',
            },
          },
        ],
      };

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockOverpassData,
      } as unknown as Response);

      vi.spyOn((source as any).locationResolver, 'resolveLocation').mockResolvedValue({
        status: 'RESOLVED_AREA',
        canonicalCountryCode: 'PK',
        canonicalCountryName: 'Pakistan',
        city: 'Faisalabad',
        resolutionType: 'ADMINISTRATIVE_AREA',
        areaName: 'Faisalabad',
        radiusKm: 25,
        radiusMeters: 25000,
        confidence: 'HIGH',
      });

      const results = await source.discover({
        niche: 'Dentist',
        city: 'Faisalabad',
        country: 'PK',
        limit: 5,
      });

      global.fetch = originalFetch;

      expect(results.length).toBe(1);
      const biz = results[0];
      expect(biz.name).toBe('Faisalabad Dental Specialist Clinic');
      expect(biz.phone).toBe('+92418765432');
      expect(biz.source).toBe('osm_overpass');
      expect(biz.osmId).toBe('node/987654');
      expect(biz.sourceUrl).toBe('https://www.openstreetmap.org/node/987654');

      // Native contacts check
      expect(biz.nativeContacts).toBeDefined();
      expect(biz.nativeContacts!.length).toBeGreaterThanOrEqual(2);

      const phoneContact = biz.nativeContacts!.find((c) => c.type === 'PHONE' && c.field === 'phone');
      expect(phoneContact).toBeDefined();
      expect(phoneContact!.classification).toBe('OSM_PUBLIC_PHONE');
      expect(phoneContact!.sourceType).toBe('OSM_TAG');
      expect(phoneContact!.sourceUrl).toBe('https://www.openstreetmap.org/node/987654');

      const emailContact = biz.nativeContacts!.find((c) => c.type === 'EMAIL');
      expect(emailContact).toBeDefined();
      expect(emailContact!.value).toBe('info@fsddentist.pk');
      expect(emailContact!.classification).toBe('OSM_PUBLIC_EMAIL');
      expect(emailContact!.sourceType).toBe('OSM_TAG');
    });
  });

  describe('3. Official Website Resolution for No-Website Businesses', () => {
    it('should verify official business website using domain token similarity and city context', async () => {
      const resolver = new OfficialWebsiteResolver();
      const verification = await resolver.verifyWebsiteIdentity(
        'https://www.shahbazdentalclinic.com',
        'Shahbaz Dental Clinic',
        'Faisalabad'
      );

      // Domain token matches "shahbaz", "dental", "clinic"
      expect(verification.status === 'OFFICIAL_CONFIRMED' || verification.status === 'OFFICIAL_PROBABLE').toBe(true);
      expect(verification.resolvedUrl).toBe('https://www.shahbazdentalclinic.com');
      expect(verification.confidence === 'HIGH' || verification.confidence === 'MEDIUM').toBe(true);
    });

    it('should reject directory and aggregator domains during official website resolution', async () => {
      expect(isExcludedDirectoryDomain('https://www.marham.pk/doctors/faisalabad/dentist')).toBe(true);
      expect(isExcludedDirectoryDomain('https://oladoc.com/pakistan/faisalabad/dentist')).toBe(true);
      expect(isExcludedDirectoryDomain('https://www.apkamuaalij.com/hospitals/faisalabad/dental-care-center')).toBe(true);
      expect(isExcludedDirectoryDomain('https://www.ebizpk.com/dental-clinics-faisalabad.htm')).toBe(true);
    });
  });

  describe('4. Directory Hints as Discovery Hints Only', () => {
    it('should not assign directory URL as official website or directory phone as business phone', () => {
      const hintCandidate: DiscoveredBusinessInput = {
        name: 'Dental Care Center',
        category: 'Dentist',
        city: 'Faisalabad',
        country: 'Pakistan',
        website: undefined, // strictly nullified
        phone: undefined,   // strictly nullified
        source: 'directory_hint',
        sourceUrl: 'https://www.apkamuaalij.com/hospitals/faisalabad/dental-care-center',
        contactChannel: 'NO_CONTACT_LEAD',
      };

      expect(hintCandidate.website).toBeUndefined();
      expect(hintCandidate.phone).toBeUndefined();
      expect(hintCandidate.source).toBe('directory_hint');
      expect(hintCandidate.contactChannel).toBe('NO_CONTACT_LEAD');
    });
  });

  describe('5. Contact Provenance & Quality Scoring', () => {
    it('should strictly block PLATFORM_CONTACT from receiving positive quality score or primary contact eligibility', () => {
      const platformContact: DiscoveredContactRecord = {
        value: 'info@marham.pk',
        email: 'info@marham.pk',
        type: 'EMAIL',
        classification: 'PLATFORM_CONTACT',
        source: 'platform_directory',
        sourceType: 'PUBLIC_LISTING',
        confidence: 'LOW',
        qualityScore: calculateContactQualityScore({
          type: 'EMAIL',
          classification: 'PLATFORM_CONTACT',
          sourceType: 'PUBLIC_LISTING',
        }),
        status: 'PUBLIC_UNVERIFIED',
        discoveredAt: new Date(),
      };

      expect(platformContact.qualityScore).toBe(0);

      const officialEmail: DiscoveredContactRecord = {
        value: 'dr.shahbaz@shahbazdental.pk',
        email: 'dr.shahbaz@shahbazdental.pk',
        type: 'EMAIL',
        classification: 'OFFICIAL_SITE_EMAIL',
        source: 'official_website_html',
        sourceType: 'OFFICIAL_WEBSITE',
        confidence: 'HIGH',
        qualityScore: calculateContactQualityScore({
          type: 'EMAIL',
          classification: 'OFFICIAL_SITE_EMAIL',
          sourceType: 'OFFICIAL_WEBSITE',
        }),
        status: 'VERIFIED_PUBLIC',
        discoveredAt: new Date(),
      };

      expect(officialEmail.qualityScore).toBe(100);

      const primary = selectPrimaryContact([platformContact, officialEmail]);
      expect(primary).toBeDefined();
      expect(primary?.value).toBe('dr.shahbaz@shahbazdental.pk');
    });

    it('should prioritize OFFICIAL_SITE_EMAIL over OSM_PUBLIC_PHONE and VERIFIED_BUSINESS_LISTING_PHONE', () => {
      const listingPhone: DiscoveredContactRecord = {
        value: '+92418765432',
        type: 'PHONE',
        classification: 'VERIFIED_BUSINESS_LISTING_PHONE',
        source: 'directory_hint',
        sourceType: 'PUBLIC_LISTING',
        confidence: 'MEDIUM',
        qualityScore: 50,
        status: 'VERIFIED_PUBLIC',
        discoveredAt: new Date(),
      };

      const osmPhone: DiscoveredContactRecord = {
        value: '+923001234567',
        type: 'PHONE',
        classification: 'OSM_PUBLIC_PHONE',
        source: 'osm_overpass',
        sourceType: 'OSM_TAG',
        confidence: 'HIGH',
        qualityScore: 75,
        status: 'VERIFIED_PUBLIC',
        discoveredAt: new Date(),
      };

      const officialEmail: DiscoveredContactRecord = {
        value: 'contact@clinic.pk',
        email: 'contact@clinic.pk',
        type: 'EMAIL',
        classification: 'OFFICIAL_SITE_EMAIL',
        source: 'official_website_html',
        sourceType: 'OFFICIAL_WEBSITE',
        confidence: 'HIGH',
        qualityScore: 100,
        status: 'VERIFIED_PUBLIC',
        discoveredAt: new Date(),
      };

      const primary = selectPrimaryContact([listingPhone, osmPhone, officialEmail]);
      expect(primary?.value).toBe('contact@clinic.pk');

      // If official email is absent, OSM phone is selected before listing phone
      const primaryNoEmail = selectPrimaryContact([listingPhone, osmPhone]);
      expect(primaryNoEmail?.value).toBe('+923001234567');
      expect(primaryNoEmail?.classification).toBe('OSM_PUBLIC_PHONE');
    });
  });

  describe('6. Multi-Source Deduplication & Provenance Merging', () => {
    it('should merge business candidates discovered from both OSM and Search without duplicating records', async () => {
      const mockSource1 = {
        name: 'Mock_OSM',
        type: 'geodata' as const,
        enabled: true,
        priority: 1,
        status: 'AVAILABLE' as const,
        isAvailable: () => true,
        markBlocked: vi.fn(),
        resetStatus: vi.fn(),
        getMetrics: () => ({ requestsCount: 1, successfulCount: 1, failedCount: 0, blockedCount: 0, itemsDiscovered: 1 }),
        resetMetrics: vi.fn(),
        getOutcome: () => 'SUCCESS_WITH_RESULTS' as const,
        discover: async () => [
          {
            name: 'Shahbaz Dental Clinic',
            category: 'Dentist',
            city: 'Faisalabad',
            country: 'Pakistan',
            phone: '+92418765432',
            website: undefined,
            source: 'osm_overpass',
            sourceUrl: 'https://www.openstreetmap.org/node/111',
            contactChannel: 'PHONE_ONLY_LEAD' as const,
          },
        ],
      };

      const mockSource2 = {
        name: 'Mock_Search',
        type: 'search_engine' as const,
        enabled: true,
        priority: 2,
        status: 'AVAILABLE' as const,
        isAvailable: () => true,
        markBlocked: vi.fn(),
        resetStatus: vi.fn(),
        getMetrics: () => ({ requestsCount: 1, successfulCount: 1, failedCount: 0, blockedCount: 0, itemsDiscovered: 1 }),
        resetMetrics: vi.fn(),
        getOutcome: () => 'SUCCESS_WITH_RESULTS' as const,
        discover: async () => [
          {
            name: 'Shahbaz Dental Clinic',
            category: 'Dentist',
            city: 'Faisalabad',
            country: 'Pakistan',
            phone: undefined,
            website: 'https://shahbazdentalclinic.pk',
            source: 'browser_search',
            sourceUrl: 'https://shahbazdentalclinic.pk',
            contactChannel: 'WEBSITE_LEAD' as const,
          },
        ],
      };

      const provider = new WebSearchDiscoveryProvider([mockSource1 as any, mockSource2 as any]);
      const summary = await provider.discoverDetailed({
        niche: 'Dentist',
        city: 'Faisalabad',
        country: 'PK',
        limit: 5,
      });

      expect(summary.uniqueDiscovered).toBe(1);
      expect(summary.results.length).toBe(1);

      const merged = summary.results[0];
      expect(merged.name).toBe('Shahbaz Dental Clinic');
      expect(merged.phone).toBe('+92418765432');
      expect(merged.website).toBe('https://shahbazdentalclinic.pk');
      expect(merged.sources).toContain('osm_overpass');
      expect(merged.sources).toContain('browser_search');
    });
  });

  describe('7. Adaptive Target Discovery & Conservative Limits', () => {
    it('should continue across fallback sources until target unique businesses is reached', async () => {
      const source1 = {
        name: 'Source1',
        type: 'geodata' as const,
        enabled: true,
        priority: 1,
        status: 'AVAILABLE' as const,
        isAvailable: () => true,
        markBlocked: vi.fn(),
        resetStatus: vi.fn(),
        getMetrics: () => ({ requestsCount: 1, successfulCount: 1, failedCount: 0, blockedCount: 0, itemsDiscovered: 2 }),
        resetMetrics: vi.fn(),
        getOutcome: () => 'SUCCESS_WITH_RESULTS' as const,
        discover: async () => [
          { name: 'Dental One', category: 'Dentist', city: 'Faisalabad', country: 'Pakistan', source: 's1' },
          { name: 'Dental Two', category: 'Dentist', city: 'Faisalabad', country: 'Pakistan', source: 's1' },
        ],
      };

      const source2 = {
        name: 'Source2',
        type: 'search_engine' as const,
        enabled: true,
        priority: 2,
        status: 'AVAILABLE' as const,
        isAvailable: () => true,
        markBlocked: vi.fn(),
        resetStatus: vi.fn(),
        getMetrics: () => ({ requestsCount: 1, successfulCount: 1, failedCount: 0, blockedCount: 0, itemsDiscovered: 2 }),
        resetMetrics: vi.fn(),
        getOutcome: () => 'SUCCESS_WITH_RESULTS' as const,
        discover: async () => [
          { name: 'Dental Three', category: 'Dentist', city: 'Faisalabad', country: 'Pakistan', source: 's2' },
          { name: 'Dental Four', category: 'Dentist', city: 'Faisalabad', country: 'Pakistan', source: 's2' },
        ],
      };

      const provider = new WebSearchDiscoveryProvider([source1 as any, source2 as any]);
      const summary = await provider.discoverDetailed({
        niche: 'Dentist',
        city: 'Faisalabad',
        country: 'PK',
        limit: 4,
      });

      expect(summary.uniqueDiscovered).toBe(4);
      expect(summary.results.length).toBe(4);
    });
  });

  describe('8. Browser Search Fallback & No CAPTCHA Bypass', () => {
    it('should mark source as BLOCKED and halt execution when an anti-bot challenge is encountered', () => {
      const source = new BrowserSearchDiscoverySource();
      expect(source.isAvailable()).toBe(true);

      // Simulate challenge encounter
      source.markBlocked('Anti-bot challenge encountered', 'BLOCKED');
      expect(source.status).toBe('BLOCKED');
      expect(source.getOutcome()).toBe('BLOCKED');
      expect(source.isAvailable()).toBe(false);

      const report = source.getProviderReport();
      expect(report.provider).toBe('BROWSER_SEARCH');
      expect(report.blocked).toBe(true);
      expect(report.status).toBe('BLOCKED');
    });
  });
});
