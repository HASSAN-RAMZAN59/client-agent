import { isValidEmailCandidate } from '../extractors/email-extractor.js';
import { normalizePhoneNumber } from '../extractors/phone-extractor.js';

export interface EmailValidationResult {
  isValid: boolean;
  domainMatchesOfficialWebsite: boolean;
  reason?: string;
}

export interface PhoneValidationResult {
  isValid: boolean;
  normalized?: string;
  country?: string;
  reason?: string;
}

export function validateEmail(email: string, officialWebsiteUrl?: string): EmailValidationResult {
  if (!isValidEmailCandidate(email)) {
    return {
      isValid: false,
      domainMatchesOfficialWebsite: false,
      reason: 'Malformed or blacklisted email format',
    };
  }

  const emailDomain = email.split('@')[1]?.toLowerCase().trim();

  let domainMatches = true;
  if (officialWebsiteUrl && officialWebsiteUrl.trim().length > 0) {
    try {
      const siteUrl = new URL(
        officialWebsiteUrl.startsWith('http') ? officialWebsiteUrl : `https://${officialWebsiteUrl}`
      );
      const siteHost = siteUrl.hostname.replace(/^www\./i, '').toLowerCase();

      // Check exact match or subdomain
      domainMatches = emailDomain === siteHost || emailDomain?.endsWith(`.${siteHost}`) || siteHost.endsWith(`.${emailDomain}`);
    } catch {
      domainMatches = false;
    }
  }

  return {
    isValid: true,
    domainMatchesOfficialWebsite: domainMatches,
  };
}

export function validatePhone(phone: string): PhoneValidationResult {
  const norm = normalizePhoneNumber(phone);
  if (!norm) {
    return {
      isValid: false,
      reason: 'Invalid phone number format or length',
    };
  }

  return {
    isValid: true,
    normalized: norm.normalized,
    country: norm.country,
  };
}
