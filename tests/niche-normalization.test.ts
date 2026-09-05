import { describe, it, expect } from 'vitest';
import { normalizeNiche, getAllCanonicalNiches } from '../src/modules/discovery/niche-normalizer.js';
import { generateDiscoveryQueries } from '../src/modules/discovery/query-generator.js';
import { OsmOverpassDiscoverySource } from '../src/modules/discovery/sources/osm-overpass.source.js';
import { preSendValidator } from '../src/modules/outreach/gate/pre-send-validator.js';

describe('Canonical Niche Normalization & Discovery Expansion Suite', () => {
  describe('1. Required Niches Normalization (Dental, Dentist, dental /dentist, Dental Clinic, HVAC, Cafe, Restaurant, Hardware Store)', () => {
    it('should normalize "Dental" to canonical DENTIST with clean label and natural aliases', () => {
      const result = normalizeNiche('Dental');
      expect(result.isValid).toBe(true);
      expect(result.canonical).toBe('DENTIST');
      expect(result.label).toBe('Dentist');
      expect(result.primaryQueryTerm).toBe('dentist');
      expect(result.aliases).toContain('dentist');
      expect(result.aliases).toContain('dental clinic');
      expect(result.aliases).toContain('dental surgery');
      expect(result.aliases).toContain('dentistry');
    });

    it('should normalize "Dentist" to canonical DENTIST with clean label and natural aliases', () => {
      const result = normalizeNiche('Dentist');
      expect(result.isValid).toBe(true);
      expect(result.canonical).toBe('DENTIST');
      expect(result.label).toBe('Dentist');
      expect(result.primaryQueryTerm).toBe('dentist');
      expect(result.aliases).toEqual(['dentist', 'dental clinic', 'dental surgery', 'dentistry']);
    });

    it('should normalize composite "dental /dentist" to canonical DENTIST without slashes', () => {
      const result = normalizeNiche('dental /dentist');
      expect(result.isValid).toBe(true);
      expect(result.canonical).toBe('DENTIST');
      expect(result.label).toBe('Dentist');
      expect(result.primaryQueryTerm).toBe('dentist');
      expect(result.aliases).toEqual(['dentist', 'dental clinic', 'dental surgery', 'dentistry']);
    });

    it('should normalize "Dental Clinic" to canonical DENTIST', () => {
      const result = normalizeNiche('Dental Clinic');
      expect(result.isValid).toBe(true);
      expect(result.canonical).toBe('DENTIST');
      expect(result.label).toBe('Dentist');
      expect(result.primaryQueryTerm).toBe('dentist');
      expect(result.aliases).toContain('dentist');
    });

    it('should normalize "HVAC" to canonical HVAC with clean label and natural aliases', () => {
      const result = normalizeNiche('HVAC');
      expect(result.isValid).toBe(true);
      expect(result.canonical).toBe('HVAC');
      expect(result.label).toBe('HVAC');
      expect(result.primaryQueryTerm).toBe('hvac');
      expect(result.aliases).toEqual(['hvac', 'air conditioning', 'heating and cooling', 'ac repair']);
      expect(result.osmTags).toEqual(['["craft"="hvac"]', '["craft"="electrician"]', '["craft"="plumber"]']);
    });

    it('should normalize "Cafe" to canonical CAFE with clean label and natural aliases', () => {
      const result = normalizeNiche('Cafe');
      expect(result.isValid).toBe(true);
      expect(result.canonical).toBe('CAFE');
      expect(result.label).toBe('Cafe');
      expect(result.primaryQueryTerm).toBe('cafe');
      expect(result.aliases).toEqual(['cafe', 'coffee shop', 'bakery cafe', 'espresso bar']);
      expect(result.osmTags).toEqual(['["amenity"="cafe"]', '["shop"="bakery"]']);
    });

    it('should normalize "Restaurant" to canonical RESTAURANT with clean label and natural aliases', () => {
      const result = normalizeNiche('Restaurant');
      expect(result.isValid).toBe(true);
      expect(result.canonical).toBe('RESTAURANT');
      expect(result.label).toBe('Restaurant');
      expect(result.primaryQueryTerm).toBe('restaurant');
      expect(result.aliases).toEqual(['restaurant', 'dining', 'bistro', 'eatery']);
      expect(result.osmTags).toEqual(['["amenity"="restaurant"]', '["amenity"="fast_food"]']);
    });

    it('should normalize "Hardware Store" to canonical HARDWARE_STORE with clean label and natural aliases', () => {
      const result = normalizeNiche('Hardware Store');
      expect(result.isValid).toBe(true);
      expect(result.canonical).toBe('HARDWARE_STORE');
      expect(result.label).toBe('Hardware Store');
      expect(result.primaryQueryTerm).toBe('hardware store');
      expect(result.aliases).toEqual(['hardware store', 'tools and hardware', 'building supplies', 'home improvement']);
      expect(result.osmTags).toContain('["shop"="hardware"]');
    });
  });

  describe('2. Generic Multi-Niche Registry Architecture', () => {
    it('should support all standard commercial niches generically', () => {
      const all = getAllCanonicalNiches();
      const canonicalKeys = all.map((n) => n.canonical);
      expect(canonicalKeys).toContain('DENTIST');
      expect(canonicalKeys).toContain('HVAC');
      expect(canonicalKeys).toContain('CAFE');
      expect(canonicalKeys).toContain('RESTAURANT');
      expect(canonicalKeys).toContain('HARDWARE_STORE');
      expect(canonicalKeys).toContain('DOCTOR');
      expect(canonicalKeys).toContain('PLUMBER');
      expect(canonicalKeys).toContain('LAWYER');
      expect(canonicalKeys).toContain('ROOFING');
      expect(canonicalKeys).toContain('AUTO_DEALERSHIP');
      expect(canonicalKeys).toContain('REAL_ESTATE');
      expect(canonicalKeys).toContain('GYM');
      expect(canonicalKeys).toContain('SALON');
      expect(canonicalKeys).toContain('CLEANING');
      expect(canonicalKeys).toContain('SOFTWARE');
    });
  });

  describe('3. Query Generator Expansion & Slash Prevention', () => {
    it('should never include raw slash combined string like "dental /dentist" in search queries', () => {
      const queries = generateDiscoveryQueries({
        niche: 'dental /dentist',
        city: 'Faisalabad',
        country: 'Pakistan',
        maxQueries: 5,
      });

      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) {
        expect(q.query).not.toContain('/');
        expect(q.query).not.toContain('dental /dentist');
        expect(q.query).not.toContain('dental/dentist');
      }

      // Check natural aliases are used across query intents
      const queryTexts = queries.map((q) => q.query);
      expect(queryTexts.some((t) => t.includes('"dentist"'))).toBe(true);
      expect(queryTexts.some((t) => t.includes('"dental clinic"'))).toBe(true);
      expect(queryTexts.some((t) => t.includes('"dental surgery"'))).toBe(true);
    });

    it('should expand canonical HVAC into natural aliases across query variants', () => {
      const queries = generateDiscoveryQueries({
        niche: 'HVAC',
        city: 'Dallas',
        state: 'TX',
        country: 'US',
        maxQueries: 4,
      });

      const queryTexts = queries.map((q) => q.query.toLowerCase());
      expect(queryTexts.some((t) => t.includes('"hvac"'))).toBe(true);
      expect(queryTexts.some((t) => t.includes('"air conditioning"'))).toBe(true);
      expect(queryTexts.some((t) => t.includes('"heating and cooling"'))).toBe(true);
    });
  });

  describe('4. OSM Tag Mapping with Canonical Niche', () => {
    it('should resolve OSM tags for composite "dental /dentist" via canonical mapping', () => {
      const osmSource = new OsmOverpassDiscoverySource();
      const tags = (osmSource as any).mapNicheToOsmTags('dental /dentist', 'PK');
      expect(tags).toContain('["amenity"="dentist"]');
      expect(tags).toContain('["healthcare"="dentist"]');
    });

    it('should resolve OSM tags for "Hardware Store"', () => {
      const osmSource = new OsmOverpassDiscoverySource();
      const tags = (osmSource as any).mapNicheToOsmTags('Hardware Store', 'US');
      expect(tags.some((t: string) => t.includes('hardware'))).toBe(true);
    });
  });

  describe('5. Unknown Niche Handling & Sanitization', () => {
    it('should clearly reject empty or pure punctuation input', () => {
      expect(normalizeNiche('').isValid).toBe(false);
      expect(normalizeNiche('   ').isValid).toBe(false);
      expect(normalizeNiche('///').isValid).toBe(false);
      expect(normalizeNiche('---').isValid).toBe(false);
    });

    it('should safely sanitize unknown commercial niche without allowing slashes into queries', () => {
      const result = normalizeNiche('pet grooming / dog wash');
      expect(result.isValid).toBe(true);
      expect(result.canonical).toBe('PET_GROOMING');
      expect(result.label).toBe('Pet Grooming');
      expect(result.primaryQueryTerm).toBe('pet grooming');
      expect(result.aliases).toContain('pet grooming');
      expect(result.aliases).toContain('dog wash');

      const queries = generateDiscoveryQueries({
        niche: 'pet grooming / dog wash',
        city: 'Austin',
        country: 'US',
        maxQueries: 3,
      });
      for (const q of queries) {
        expect(q.query).not.toContain('/');
        expect(q.query).not.toContain('pet grooming / dog wash');
      }
    });
  });

  describe('6. Pre-Send Niche Validator Cross-Matching', () => {
    it('should match canonical DENTIST across variations ("dental /dentist" vs "Dental Clinic")', () => {
      expect(preSendValidator.isNicheMatch('Dental Clinic', 'dental /dentist')).toBe(true);
      expect(preSendValidator.isNicheMatch('Dental Surgery Center', 'Dentist')).toBe(true);
      expect(preSendValidator.isNicheMatch('Dallas Smiles Dentistry', 'dental /dentist')).toBe(true);
      expect(preSendValidator.isNicheMatch('Auto Body Shop', 'dental /dentist')).toBe(false);
    });

    it('should match HVAC across heating and cooling variations', () => {
      expect(preSendValidator.isNicheMatch('Air Pro AC Repair', 'HVAC')).toBe(true);
      expect(preSendValidator.isNicheMatch('Heating & Cooling Experts', 'hvac')).toBe(true);
      expect(preSendValidator.isNicheMatch('Bakery', 'HVAC')).toBe(false);
    });
  });

  describe('7. Campaign Internal Storage & UI Display Labels', () => {
    it('should store canonical DENTIST when user inputs "dental /dentist" and provide display label "Dentist"', async () => {
      const { CampaignRepository } = await import('../src/database/repositories/campaign.repository.js');
      const { vi } = await import('vitest');

      let storedData: any = null;
      const mockDb = {
        campaign: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            storedData = {
              id: 'mock-canonical-niche-id',
              ...data,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            return storedData;
          }),
          findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
            if (storedData && storedData.id === where.id) {
              return storedData;
            }
            return null;
          }),
        },
      };

      const repo = new CampaignRepository(mockDb as any);

      const campaign = await repo.createCampaign({
        name: 'Test Dental Canonical Campaign',
        city: 'Faisalabad',
        country: 'PK',
        niche: 'dental /dentist',
        targetBusinesses: 10,
      });

      // Internal storage in database column is canonical DENTIST
      expect(campaign.niche).toBe('DENTIST');
      expect(campaign.canonicalNiche).toBe('DENTIST');
      // Clean display label for UI is Dentist
      expect(campaign.displayNiche).toBe('Dentist');
      // Raw user input preserved
      expect(campaign.rawNiche).toBe('dental /dentist');

      // Database create call received canonical niche
      expect(mockDb.campaign.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            niche: 'DENTIST',
          }),
        })
      );

      // Fetch back by ID confirms canonical storage & display enrichment
      const fetched = await repo.getCampaignById('mock-canonical-niche-id');
      expect(fetched?.niche).toBe('DENTIST');
      expect(fetched?.canonicalNiche).toBe('DENTIST');
      expect(fetched?.displayNiche).toBe('Dentist');
    });
  });
});
