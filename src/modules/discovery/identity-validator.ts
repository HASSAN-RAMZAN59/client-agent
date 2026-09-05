/**
 * Business Identity Validation & Safety Gate
 * Prevents generic search queries, directory headings, and category labels
 * from becoming persisted business leads.
 */

export interface BusinessIdentityValidationResult {
  isValid: boolean;
  cleanedName: string;
  isUnsafe: boolean;
  reason?: string;
  category:
    | 'SAFE'
    | 'GENERIC_SEARCH_TITLE'
    | 'GENERIC_SERVICE_LABEL'
    | 'DIRECTORY_HEADING'
    | 'SCRAPING_ARTIFACT';
}

const GENERIC_SEARCH_TITLE_REGEX =
  /\b(?:best|top|leading|cheap|affordable|recommended|find|top\s*\d+|10\s*best|\d+\s*best)\s+(?:dentists?|dentistry|dental|clinics?|doctors?|surgeons?|hvac|plumbers?|lawyers?|attorneys?|roofers?|cleaners?)\b/i;

const YEAR_SEARCH_REGEX = /\b(202[0-9]|203[0-9])\b/;

const GENERIC_EXACT_LABELS = new Set([
  'dental',
  'dentist',
  'dentists',
  'dentistry',
  'dental clinic',
  'dental clinics',
  'dental surgery',
  'dental care',
  'dental center',
  'dental centre',
  'dental services',
  'dental hospital',
  'doctor',
  'doctors',
  'clinic',
  'clinics',
  'hospital',
  'hospitals',
  'medical center',
  'medical centre',
  'hvac',
  'air conditioning',
  'plumbing',
  'plumber',
  'lawyer',
  'lawyers',
  'attorney',
  'attorneys',
  'roofing',
  'cleaning',
]);

/**
 * Validates whether a candidate business name represents a real, distinct commercial business
 * or an unsafe generic search title / directory heading.
 */
export function validateBusinessIdentity(
  rawName: string | null | undefined,
  context?: {
    niche?: string;
    city?: string;
    country?: string;
  }
): BusinessIdentityValidationResult {
  if (!rawName || typeof rawName !== 'string' || !rawName.trim()) {
    return {
      isValid: false,
      cleanedName: '',
      isUnsafe: true,
      reason: 'EMPTY_NAME',
      category: 'SCRAPING_ARTIFACT',
    };
  }

  // Normalize whitespace and strip common scraping punctuation artifacts (e.g. trailing comma)
  let clean = rawName.trim().replace(/^[\s,;:\-–—|/•]+|[\s,;:\-–—|/•]+$/g, '');

  // Strip trailing year artifacts if attached to search titles (e.g., "Best Dentist in Faisalabad 2026")
  const lower = clean.toLowerCase();

  // 1. Scraping artifacts
  if (clean.length < 3) {
    return {
      isValid: false,
      cleanedName: clean,
      isUnsafe: true,
      reason: 'NAME_TOO_SHORT',
      category: 'SCRAPING_ARTIFACT',
    };
  }

  // 2. Generic Search Titles (e.g., "Best Dentist in Faisalabad 2026", "Top Dental Clinics", "Best Dental Clinic")
  if (GENERIC_SEARCH_TITLE_REGEX.test(clean)) {
    return {
      isValid: false,
      cleanedName: clean,
      isUnsafe: true,
      reason: 'GENERIC_SEARCH_RANKING_TITLE',
      category: 'GENERIC_SEARCH_TITLE',
    };
  }

  if (YEAR_SEARCH_REGEX.test(clean) && (lower.includes('dentist') || lower.includes('dental') || lower.includes('doctor') || lower.includes('clinic'))) {
    return {
      isValid: false,
      cleanedName: clean,
      isUnsafe: true,
      reason: 'DATED_SEO_SEARCH_TITLE',
      category: 'GENERIC_SEARCH_TITLE',
    };
  }

  // 3. Exact Generic Service Labels (e.g., "Dental Clinics", "Dental Clinic", "DENTAL SURGERY")
  // Strip city suffix if present to check root genericness
  let rootClean = lower;
  if (context?.city) {
    rootClean = rootClean
      .replace(new RegExp(`\\b(?:in\\s+)?${context.city.toLowerCase()}\\b`, 'gi'), '')
      .trim();
  }
  rootClean = rootClean.replace(/^[\s,;:\-–—|/•]+|[\s,;:\-–—|/•]+$/g, '');

  if (GENERIC_EXACT_LABELS.has(lower) || GENERIC_EXACT_LABELS.has(rootClean)) {
    return {
      isValid: false,
      cleanedName: clean,
      isUnsafe: true,
      reason: 'GENERIC_SERVICE_CATEGORY_LABEL',
      category: 'GENERIC_SERVICE_LABEL',
    };
  }

  // 4. Directory Headings & Listicles
  if (
    lower.startsWith('find a ') ||
    lower.startsWith('list of ') ||
    lower.includes('directory') ||
    lower.includes('yellow pages') ||
    lower.includes('marham') ||
    lower.includes('ebizpk') ||
    lower.includes('apkamuaalij')
  ) {
    return {
      isValid: false,
      cleanedName: clean,
      isUnsafe: true,
      reason: 'DIRECTORY_OR_PORTAL_HEADING',
      category: 'DIRECTORY_HEADING',
    };
  }

  // 5. Hospital department names without hospital entity context (e.g. "DENTAL SURGERY")
  if (
    lower === 'dental surgery' ||
    lower === 'department of dentistry' ||
    lower === 'dental department' ||
    lower === 'oral surgery department'
  ) {
    return {
      isValid: false,
      cleanedName: clean,
      isUnsafe: true,
      reason: 'GENERIC_HOSPITAL_DEPARTMENT_LABEL',
      category: 'GENERIC_SERVICE_LABEL',
    };
  }

  return {
    isValid: true,
    cleanedName: clean,
    isUnsafe: false,
    category: 'SAFE',
  };
}
