import { describe, it, expect } from 'vitest';
import { isExcludedDirectoryDomain } from '../src/modules/discovery/excluded-domains.js';
import { classifyWebsite } from '../src/modules/discovery/website-classifier.js';
import { validateBusinessIdentity } from '../src/modules/discovery/identity-validator.js';
import { extractPhonesFromHtml } from '../src/modules/contact-discovery/extractors/phone-extractor.js';
import {
  calculateContactQualityScore,
  selectPrimaryContact,
} from '../src/modules/contact-discovery/scoring/contact-quality.scorer.js';
import { DiscoveredContactRecord } from '../src/types/index.js';

describe('Data-Quality Hardening: Directory Exclusion & Classification', () => {
  it('1. correctly identifies excluded directory domains', () => {
    expect(isExcludedDirectoryDomain('marham.pk')).toBe(true);
    expect(isExcludedDirectoryDomain('www.marham.pk')).toBe(true);
    expect(isExcludedDirectoryDomain('oladoc.com')).toBe(true);
    expect(isExcludedDirectoryDomain('ebizpk.com')).toBe(true);
    expect(isExcludedDirectoryDomain('faisalabad.ebizpk.com')).toBe(true);
    expect(isExcludedDirectoryDomain('apkamuaalij.com')).toBe(true);
    expect(isExcludedDirectoryDomain('facebook.com')).toBe(true);
    expect(isExcludedDirectoryDomain('yelp.com')).toBe(true);

    // Legitimate business domains are NOT excluded
    expect(isExcludedDirectoryDomain('myfaisalabaddental.com')).toBe(false);
    expect(isExcludedDirectoryDomain('rahmadentalclinic.pk')).toBe(false);
  });

  it('2. classifies known directory and aggregator URLs correctly', () => {
    const marhamRes = classifyWebsite(
      'https://www.marham.pk/doctors/faisalabad/dentist',
      'Best Dentist in Faisalabad',
      'Faisalabad'
    );
    expect(['AGGREGATOR', 'DIRECTORY_LISTING']).toContain(marhamRes.type);
    expect(marhamRes.isOfficialSite).toBe(false);

    const ebizRes = classifyWebsite(
      'https://www.faisalabad.ebizpk.com/dental-clinics-faisalabad.htm',
      'Dental Clinics',
      'Faisalabad'
    );
    expect(['AGGREGATOR', 'DIRECTORY_LISTING']).toContain(ebizRes.type);
    expect(ebizRes.isOfficialSite).toBe(false);

    const apkaRes = classifyWebsite(
      'https://www.apkamuaalij.com/hospitals/faisalabad/dental-care-center',
      'Dental Care Center',
      'Faisalabad'
    );
    expect(['AGGREGATOR', 'DIRECTORY_LISTING']).toContain(apkaRes.type);
    expect(apkaRes.isOfficialSite).toBe(false);

    const oladocRes = classifyWebsite(
      'https://oladoc.com/pakistan/faisalabad/dentist',
      'Dentists in Faisalabad',
      'Faisalabad'
    );
    expect(['AGGREGATOR', 'DIRECTORY_LISTING']).toContain(oladocRes.type);
    expect(oladocRes.isOfficialSite).toBe(false);
  });

  it('3. identifies directory listing path patterns on arbitrary domains', () => {
    const listingRes = classifyWebsite(
      'https://somedomain.com/category/faisalabad/dentists',
      'Faisalabad Dentists',
      'Faisalabad'
    );
    expect(['AGGREGATOR', 'DIRECTORY_LISTING']).toContain(listingRes.type);
    expect(listingRes.isOfficialSite).toBe(false);

    const docRes = classifyWebsite(
      'https://somedomain.com/doctors/dr-ahmed',
      'Dr Ahmed Clinic'
    );
    expect(['AGGREGATOR', 'DIRECTORY_LISTING']).toContain(docRes.type);
    expect(docRes.isOfficialSite).toBe(false);
  });

  it('4. classifies genuine independent business websites as OFFICIAL_BUSINESS_SITE', () => {
    const officialRes = classifyWebsite(
      'https://www.rahman-dental.pk',
      'Rahman Dental Surgery',
      'Faisalabad'
    );
    expect(officialRes.type).toBe('OFFICIAL_BUSINESS_SITE');
    expect(officialRes.isOfficialSite).toBe(true);
  });
});

describe('Data-Quality Hardening: Business Identity Validation', () => {
  it('5. rejects generic SEO search titles with years and superlative rankings', () => {
    const result1 = validateBusinessIdentity('Best Dentist in Faisalabad 2026', {
      city: 'Faisalabad',
      niche: 'dental',
    });
    expect(result1.isValid).toBe(false);
    expect(result1.isUnsafe).toBe(true);
    expect(result1.category).toBe('GENERIC_SEARCH_TITLE');

    const result2 = validateBusinessIdentity('Top 10 Dentists in Faisalabad', {
      city: 'Faisalabad',
      niche: 'dental',
    });
    expect(result2.isValid).toBe(false);
    expect(result2.isUnsafe).toBe(true);
  });

  it('6. rejects exact generic service / category labels', () => {
    const result1 = validateBusinessIdentity('Dental Clinics');
    expect(result1.isValid).toBe(false);
    expect(result1.category).toBe('GENERIC_SERVICE_LABEL');

    const result2 = validateBusinessIdentity('Dentist');
    expect(result2.isValid).toBe(false);
    expect(result2.category).toBe('GENERIC_SERVICE_LABEL');
  });

  it('7. cleans scraping punctuation artifacts (trailing commas, pipes)', () => {
    const result = validateBusinessIdentity('Dental Care Center,');
    expect(result.cleanedName).toBe('Dental Care Center');
  });

  it('8. accepts legitimate commercial business names', () => {
    const result1 = validateBusinessIdentity('Al-Khidmat Dental Care', {
      city: 'Faisalabad',
      niche: 'dental',
    });
    expect(result1.isValid).toBe(true);
    expect(result1.isUnsafe).toBe(false);
    expect(result1.cleanedName).toBe('Al-Khidmat Dental Care');

    const result2 = validateBusinessIdentity('Smile Craft Dental Clinic', {
      city: 'Faisalabad',
      niche: 'dental',
    });
    expect(result2.isValid).toBe(true);
    expect(result2.isUnsafe).toBe(false);
  });
});

describe('Data-Quality Hardening: Pakistan Domestic Phone Extraction', () => {
  it('9. extracts and normalizes landline and mobile numbers in Pakistan', () => {
    const html = `
      <div>
        <p>Landline: 041-8712345</p>
        <p>Mobile: 0300-9876543</p>
        <p>Intl format: +92 41 8541234</p>
      </div>
    `;

    const phones = extractPhonesFromHtml(html);
    const normalized = phones.map((p) => p.normalizedPhone);

    expect(normalized).toContain('+92418712345');
    expect(normalized).toContain('+923009876543');
    expect(normalized).toContain('+92418541234');
  });
});

describe('Data-Quality Hardening: Contact Quality & Exclusion of Platform Contacts', () => {
  it('10. assigns 0 quality score to PLATFORM_CONTACT and excludes from primary contact', () => {
    const platformContact: DiscoveredContactRecord = {
      value: 'support@marham.pk',
      email: 'support@marham.pk',
      type: 'EMAIL',
      classification: 'PLATFORM_CONTACT',
      source: 'platform_directory',
      sourceType: 'OFFICIAL_WEBSITE',
      confidence: 'LOW',
      qualityScore: calculateContactQualityScore({
        type: 'EMAIL',
        classification: 'PLATFORM_CONTACT',
        sourceType: 'OFFICIAL_WEBSITE',
      }),
      status: 'PUBLIC_UNVERIFIED',
      isVerified: false,
      isPublic: true,
      discoveredAt: new Date(),
    };

    expect(platformContact.qualityScore).toBe(0);

    // If only a platform contact exists, selectPrimaryContact must return undefined
    const selectedSolo = selectPrimaryContact([platformContact]);
    expect(selectedSolo).toBeUndefined();

    // If a legitimate phone exists alongside platform contact, legitimate phone must win
    const legitimatePhone: DiscoveredContactRecord = {
      value: '+92418712345',
      type: 'PHONE',
      classification: 'BUSINESS_GENERIC',
      source: 'official_website_html',
      sourceType: 'OFFICIAL_WEBSITE',
      confidence: 'HIGH',
      qualityScore: 60,
      status: 'VERIFIED_PUBLIC',
      discoveredAt: new Date(),
    };

    const selectedPair = selectPrimaryContact([platformContact, legitimatePhone]);
    expect(selectedPair?.value).toBe('+92418712345');
  });
});
