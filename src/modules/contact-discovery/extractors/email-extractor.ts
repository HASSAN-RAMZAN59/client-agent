import { ContactClassification } from '../../../types/index.js';

export interface ExtractedEmail {
  email: string;
  classification: ContactClassification;
  rawSource: string; // 'mailto' | 'text'
}

const GENERIC_PREFIXES = new Set([
  'info',
  'contact',
  'hello',
  'office',
  'admin',
  'support',
  'appointments',
  'appointment',
  'booking',
  'frontdesk',
  'inquiries',
  'inquiry',
  'help',
  'care',
  'team',
  'mail',
  'general',
]);

const DEPARTMENT_PREFIXES = new Set([
  'billing',
  'sales',
  'careers',
  'jobs',
  'hr',
  'press',
  'media',
  'marketing',
  'accounting',
  'finance',
  'legal',
  'insurance',
  'compliance',
  'records',
]);

const BLACKLIST_DOMAINS = new Set([
  'example.com',
  'domain.com',
  'yourdomain.com',
  'yoursite.com',
  'sentry.io',
  'wixpress.com',
  'wordpress.org',
  'schema.org',
  'w3.org',
  'google.com',
  'github.com',
  'cloudflare.com',
  'bootstrap.com',
  'fontawesome.com',
  'gravatar.com',
]);

const ASSET_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ttf|eot|ico)$/i;

export function classifyEmail(email: string): ContactClassification {
  const localPart = email.split('@')[0]?.toLowerCase().trim() || '';
  const basePrefix = localPart.split(/[._+-]/)[0] || '';

  if (GENERIC_PREFIXES.has(localPart) || GENERIC_PREFIXES.has(basePrefix)) {
    return 'BUSINESS_GENERIC';
  }

  if (DEPARTMENT_PREFIXES.has(localPart) || DEPARTMENT_PREFIXES.has(basePrefix)) {
    return 'BUSINESS_DEPARTMENT';
  }

  // If contains honorifics (dr, dds, dmd) or recognizable person naming (firstname.lastname)
  if (
    localPart.startsWith('dr.') ||
    localPart.startsWith('dr_') ||
    localPart.startsWith('dr') ||
    localPart.includes('.') ||
    localPart.includes('_')
  ) {
    return 'BUSINESS_NAMED';
  }

  // Single word names often represent individuals (e.g. john@, sarah@)
  if (/^[a-z]{3,15}$/.test(localPart) && !GENERIC_PREFIXES.has(localPart) && !DEPARTMENT_PREFIXES.has(localPart)) {
    return 'BUSINESS_NAMED';
  }

  return 'UNKNOWN';
}

export function extractEmailsFromHtml(html: string): ExtractedEmail[] {
  const results: Map<string, ExtractedEmail> = new Map();

  // 1. Extract from mailto: links (highest reliability)
  const mailtoRegex = /href=["']mailto:\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})([^"']*)?["']/gi;
  let match: RegExpExecArray | null;

  while ((match = mailtoRegex.exec(html)) !== null) {
    const rawEmail = match[1]?.toLowerCase().trim();
    if (rawEmail && isValidEmailCandidate(rawEmail)) {
      results.set(rawEmail, {
        email: rawEmail,
        classification: classifyEmail(rawEmail),
        rawSource: 'mailto',
      });
    }
  }

  // 2. Extract from visible HTML text
  const emailRegex = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
  while ((match = emailRegex.exec(html)) !== null) {
    const rawEmail = match[0]?.toLowerCase().trim();
    if (rawEmail && isValidEmailCandidate(rawEmail) && !results.has(rawEmail)) {
      results.set(rawEmail, {
        email: rawEmail,
        classification: classifyEmail(rawEmail),
        rawSource: 'text',
      });
    }
  }

  return Array.from(results.values());
}

export function isValidEmailCandidate(email: string): boolean {
  if (!email || email.length < 5 || email.length > 254) return false;
  if (ASSET_EXTENSIONS.test(email)) return false;

  const parts = email.split('@');
  if (parts.length !== 2) return false;

  const [local, domain] = parts;
  if (!local || !domain) return false;
  if (local.length > 64) return false;

  const domainLower = domain.toLowerCase();
  if (BLACKLIST_DOMAINS.has(domainLower)) return false;
  if (!domainLower.includes('.')) return false;

  const tld = domainLower.split('.').pop();
  if (!tld || tld.length < 2 || /^\d+$/.test(tld)) return false;

  return true;
}
