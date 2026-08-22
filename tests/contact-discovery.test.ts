import { describe, it, expect } from 'vitest';
import {
  extractEmailsFromHtml,
  classifyEmail,
  isValidEmailCandidate,
} from '../src/modules/contact-discovery/extractors/email-extractor.js';
import {
  extractPhonesFromHtml,
  normalizePhoneNumber,
} from '../src/modules/contact-discovery/extractors/phone-extractor.js';
import { detectContactPages } from '../src/modules/contact-discovery/extractors/contact-page-detector.js';
import { validateEmail, validatePhone } from '../src/modules/contact-discovery/validators/contact-validator.js';
import {
  calculateContactQualityScore,
  selectPrimaryContact,
} from '../src/modules/contact-discovery/scoring/contact-quality.scorer.js';
import { ContactRepository } from '../src/database/repositories/contact.repository.js';
import { prisma } from '../src/database/index.js';

describe('Phase 5: Public Business Contact Discovery Engine', () => {
  describe('Email Extractor & Classification', () => {
    it('should extract emails from mailto: links and visible HTML text', () => {
      const sampleHtml = `
        <html>
          <body>
            <header>
              <a href="mailto:info@dallaspremierdental.com">Email Us</a>
              <a href="mailto:appointments@dallaspremierdental.com?subject=Booking">Book Now</a>
            </header>
            <main>
              <p>For billing queries, write to billing@dallaspremierdental.com.</p>
              <p>Meet Dr. Sarah Smith: dr.smith@dallaspremierdental.com</p>
            </main>
            <footer>
              <img src="/assets/logo.png" alt="logo" />
              <!-- Tracker/analytics emails should be ignored -->
              <a href="mailto:support@sentry.io">Bug report</a>
            </footer>
          </body>
        </html>
      `;

      const emails = extractEmailsFromHtml(sampleHtml);
      const emailAddresses = emails.map((e) => e.email);

      expect(emailAddresses).toContain('info@dallaspremierdental.com');
      expect(emailAddresses).toContain('appointments@dallaspremierdental.com');
      expect(emailAddresses).toContain('billing@dallaspremierdental.com');
      expect(emailAddresses).toContain('dr.smith@dallaspremierdental.com');
      expect(emailAddresses).not.toContain('support@sentry.io');
    });

    it('should correctly classify emails into BUSINESS_GENERIC, BUSINESS_DEPARTMENT, and BUSINESS_NAMED', () => {
      expect(classifyEmail('info@dentist.com')).toBe('BUSINESS_GENERIC');
      expect(classifyEmail('contact@dentist.com')).toBe('BUSINESS_GENERIC');
      expect(classifyEmail('appointments@dentist.com')).toBe('BUSINESS_GENERIC');
      expect(classifyEmail('office@dentist.com')).toBe('BUSINESS_GENERIC');

      expect(classifyEmail('billing@dentist.com')).toBe('BUSINESS_DEPARTMENT');
      expect(classifyEmail('sales@dentist.com')).toBe('BUSINESS_DEPARTMENT');
      expect(classifyEmail('careers@dentist.com')).toBe('BUSINESS_DEPARTMENT');

      expect(classifyEmail('dr.smith@dentist.com')).toBe('BUSINESS_NAMED');
      expect(classifyEmail('john.doe@dentist.com')).toBe('BUSINESS_NAMED');
    });

    it('should reject invalid, placeholder, and image asset filenames', () => {
      expect(isValidEmailCandidate('invalid-email')).toBe(false);
      expect(isValidEmailCandidate('test@example.com')).toBe(false);
      expect(isValidEmailCandidate('logo@2x.png')).toBe(false);
      expect(isValidEmailCandidate('icon@domain.com')).toBe(false);
      expect(isValidEmailCandidate('valid.dentist@customdomain.org')).toBe(true);
    });
  });

  describe('Phone Extractor & Normalizer', () => {
    it('should extract and normalize US telephone numbers from tel: links and text', () => {
      const sampleHtml = `
        <div>
          <a href="tel:2145550199">Call Direct</a>
          <p>Office Phone: (214) 555-0144</p>
          <p>Emergency line: 1-214-555-0188</p>
        </div>
      `;

      const phones = extractPhonesFromHtml(sampleHtml);
      const normalizedNumbers = phones.map((p) => p.normalizedPhone);

      expect(normalizedNumbers).toContain('+1 (214) 555-0199');
      expect(normalizedNumbers).toContain('+1 (214) 555-0144');
      expect(normalizedNumbers).toContain('+1 (214) 555-0188');
    });

    it('should normalize various raw phone formats to standard North American +1 (XXX) XXX-XXXX format', () => {
      expect(normalizePhoneNumber('2145551234')?.normalized).toBe('+1 (214) 555-1234');
      expect(normalizePhoneNumber('+1-214-555-1234')?.normalized).toBe('+1 (214) 555-1234');
      expect(normalizePhoneNumber('(214) 555.1234')?.normalized).toBe('+1 (214) 555-1234');
      expect(normalizePhoneNumber('123')?.normalized).toBeUndefined(); // Too short
    });
  });

  describe('Contact Page Detection', () => {
    it('should detect contact, about, and booking sub-pages, respecting MAX_CONTACT_PAGES limit', () => {
      const sampleHtml = `
        <nav>
          <a href="/contact-us">Contact Us</a>
          <a href="/book-online">Book Appointment</a>
          <a href="/about-our-team">About Us</a>
          <a href="/services">Services</a>
          <a href="https://external-social.com">Instagram</a>
        </nav>
      `;

      const pages = detectContactPages(sampleHtml, 'https://dallaspremierdental.com', 3);

      expect(pages.length).toBeLessThanOrEqual(3);
      expect(pages.some((p) => p.url.includes('/contact-us'))).toBe(true);
      expect(pages.some((p) => p.url.includes('/book-online'))).toBe(true);
      expect(pages.some((p) => p.url.includes('/about-our-team'))).toBe(true);
      expect(pages.some((p) => p.url.includes('external-social.com'))).toBe(false);
    });
  });

  describe('Contact Validator & Business Identity Matching', () => {
    it('should match email domain with official website domain and tag provenance confidence', () => {
      const matchingRes = validateEmail('info@dallaspremierdental.com', 'https://dallaspremierdental.com');
      expect(matchingRes.isValid).toBe(true);
      expect(matchingRes.domainMatchesOfficialWebsite).toBe(true);

      const foreignRes = validateEmail('info@unrelatedcorp.com', 'https://dallaspremierdental.com');
      expect(foreignRes.isValid).toBe(true);
      expect(foreignRes.domainMatchesOfficialWebsite).toBe(false);
    });
  });

  describe('Contact Quality Scorer & Priority Selection', () => {
    it('should score official generic email at 100 and prioritize it over other contact types', () => {
      const genericEmailScore = calculateContactQualityScore({
        type: 'EMAIL',
        classification: 'BUSINESS_GENERIC',
        sourceType: 'OFFICIAL_WEBSITE',
      });
      expect(genericEmailScore).toBe(100);

      const phoneScore = calculateContactQualityScore({
        type: 'PHONE',
        classification: 'BUSINESS_GENERIC',
        sourceType: 'OFFICIAL_WEBSITE',
      });
      expect(phoneScore).toBe(80);

      const formScore = calculateContactQualityScore({
        type: 'CONTACT_FORM',
        classification: 'BUSINESS_GENERIC',
        sourceType: 'OFFICIAL_WEBSITE',
      });
      expect(formScore).toBe(70);

      const contacts = [
        {
          value: '+1 (214) 555-0100',
          type: 'PHONE' as const,
          classification: 'BUSINESS_GENERIC' as const,
          source: 'OFFICIAL_WEBSITE',
          sourceType: 'OFFICIAL_WEBSITE' as const,
          confidence: 'HIGH' as const,
          qualityScore: 80,
          status: 'VERIFIED_PUBLIC' as const,
          discoveredAt: new Date(),
        },
        {
          value: 'info@dallaspremierdental.com',
          type: 'EMAIL' as const,
          classification: 'BUSINESS_GENERIC' as const,
          source: 'OFFICIAL_WEBSITE',
          sourceType: 'OFFICIAL_WEBSITE' as const,
          confidence: 'HIGH' as const,
          qualityScore: 100,
          status: 'VERIFIED_PUBLIC' as const,
          discoveredAt: new Date(),
        },
      ];

      const primary = selectPrimaryContact(contacts);
      expect(primary?.value).toBe('info@dallaspremierdental.com');
      expect(primary?.type).toBe('EMAIL');
    });
  });

  describe('Contact Repository Deduplication & Lead Enrichment', () => {
    it('should prevent duplicate contacts of the same type and value for a business', async () => {
      const biz = await prisma.business.create({
        data: {
          name: `Contact Test Biz ${Date.now()}`,
          category: 'Dentist',
          city: 'Dallas',
          website: 'https://testdentalcontacts.com',
          source: 'test',
        },
      });

      const repo = new ContactRepository();

      const res1 = await repo.addContact(biz.id, {
        value: 'info@testdentalcontacts.com',
        type: 'EMAIL',
        classification: 'BUSINESS_GENERIC',
        source: 'OFFICIAL_WEBSITE',
      });
      expect(res1.isNew).toBe(true);

      const res2 = await repo.addContact(biz.id, {
        value: 'info@testdentalcontacts.com',
        type: 'EMAIL',
        classification: 'BUSINESS_GENERIC',
        source: 'OFFICIAL_WEBSITE',
      });
      expect(res2.isNew).toBe(false);

      const allContacts = await repo.getContactsForBusiness(biz.id);
      expect(allContacts.length).toBe(1);
    });
  });
});
