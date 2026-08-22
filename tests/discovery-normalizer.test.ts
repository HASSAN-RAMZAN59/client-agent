import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  extractCanonicalDomain,
  normalizeBusinessName,
  createBusinessMatchKey,
  normalizePhone,
} from '../src/modules/discovery/normalizer.js';

describe('Discovery Normalizer Utilities', () => {
  describe('URL Normalization', () => {
    it('should lowercase hostnames and strip default trailing slashes', () => {
      expect(normalizeUrl('HTTP://WWW.DallasDentalCare.COM/')).toBe('http://www.dallasdentalcare.com');
      expect(normalizeUrl('https://example.com/about/')).toBe('https://example.com/about');
    });

    it('should strip common tracking query parameters while preserving regular params', () => {
      const dirtyUrl =
        'https://dallasdental.com/services?utm_source=google&utm_medium=cpc&fbclid=IwAR123&page=2&ref=directory';
      const clean = normalizeUrl(dirtyUrl);

      expect(clean).toBe('https://dallasdental.com/services?page=2');
      expect(clean).not.toContain('utm_source');
      expect(clean).not.toContain('fbclid');
      expect(clean).not.toContain('ref=');
    });

    it('should strip fragment hashes', () => {
      expect(normalizeUrl('https://dental.com/contact#form-section')).toBe('https://dental.com/contact');
    });

    it('should return undefined for invalid, non-http, or empty URLs', () => {
      expect(normalizeUrl('')).toBeUndefined();
      expect(normalizeUrl('javascript:void(0)')).toBeUndefined();
      expect(normalizeUrl('mailto:info@dental.com')).toBeUndefined();
      expect(normalizeUrl('not-a-valid-url:::')).toBeUndefined();
    });

    it('should extract canonical domain without www prefix', () => {
      expect(extractCanonicalDomain('https://www.dallasdental.com/contact?foo=1')).toBe('dallasdental.com');
      expect(extractCanonicalDomain('http://subdomain.clinic.org')).toBe('subdomain.clinic.org');
    });
  });

  describe('Business Name Normalization', () => {
    it('should trim excessive whitespace and stray punctuation', () => {
      expect(normalizeBusinessName('  Apex   Dental   Clinic,  LLC  ')).toBe('Apex Dental Clinic, LLC');
    });

    it('should generate matching keys that identify equivalent business entities', () => {
      const key1 = createBusinessMatchKey('Apex Dental Care LLC', 'Dallas');
      const key2 = createBusinessMatchKey('Apex Dental Care, Inc.', 'Dallas');
      const key3 = createBusinessMatchKey('Apex Dental Care', 'Dallas');

      expect(key1).toBe(key2);
      expect(key2).toBe(key3);
    });

    it('should distinguish businesses across different cities', () => {
      const dallasKey = createBusinessMatchKey('Apex Dental Care', 'Dallas');
      const austinKey = createBusinessMatchKey('Apex Dental Care', 'Austin');

      expect(dallasKey).not.toBe(austinKey);
    });
  });

  describe('Phone Normalization', () => {
    it('should clean formatted phone numbers', () => {
      expect(normalizePhone('+1 (214) 555-0199')).toBe('+1 (214) 555-0199');
      expect(normalizePhone('214.555.0199')).toBe('214.555.0199');
      expect(normalizePhone('123')).toBeUndefined(); // Too short
    });
  });
});
