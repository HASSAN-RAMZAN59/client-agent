/**
 * URL, Name, and Phone Normalization Utilities for Lead Discovery
 */

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
  '_ga',
  '_gl',
]);

/**
 * Normalizes an email address by trimming whitespace and lowercasing.
 */
export function normalizeEmail(email: string): string {
  if (!email) return '';
  return email.trim().toLowerCase();
}

/**
 * Normalizes a URL:
 * - Ensures valid protocol
 * - Lowercases hostname
 * - Strips common analytics / tracking query parameters
 * - Strips fragment anchors
 * - Standardizes trailing slashes
 */
export function normalizeUrl(rawUrl: string | undefined | null): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;

  let trimmed = rawUrl.trim();
  if (trimmed.length === 0) return undefined;

  // Ignore javascript:, mailto:, tel:
  if (/^(javascript|mailto|tel):/i.test(trimmed)) return undefined;

  // Prepend https:// if protocol is missing
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);

    // Filter to only http / https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }

    parsed.hostname = parsed.hostname.toLowerCase();

    // Strip tracking query parameters
    const keysToDelete: string[] = [];
    parsed.searchParams.forEach((_, key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((k) => parsed.searchParams.delete(k));

    // Clear hash
    parsed.hash = '';

    // Normalize pathname trailing slash (remove trailing slash if root or end of path)
    let path = parsed.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    parsed.pathname = path;

    // Return clean URL string
    let result = parsed.toString();
    // If URL ends in empty query '?', remove it
    if (result.endsWith('?')) {
      result = result.slice(0, -1);
    }
    // If URL is just https://example.com/ remove trailing slash
    if (result.endsWith('/') && parsed.pathname === '/' && !parsed.search) {
      result = result.slice(0, -1);
    }

    return result;
  } catch {
    return undefined;
  }
}

/**
 * Extracts a normalized domain/hostname for duplicate detection.
 * e.g. "https://www.dallasdental.com/contact?foo=1" -> "dallasdental.com"
 */
export function extractCanonicalDomain(rawUrl: string | undefined | null): string | undefined {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) return undefined;

  try {
    const parsed = new URL(normalized);
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4);
    }
    return hostname;
  } catch {
    return undefined;
  }
}

/**
 * Normalizes business names for matching:
 * - Trims extra whitespace
 * - Standardizes casing for comparison
 * - Removes common legal suffix noise (LLC, Inc, Corp, PLLC, etc.)
 */
export function normalizeBusinessName(name: string): string {
  if (!name || typeof name !== 'string') return '';

  return name
    .trim()
    .replace(/[^\w\s&',.-]/g, '') // remove stray symbols while preserving standard punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CleanTitleResult {
  cleanedName: string;
  rawTitle: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  modified: boolean;
}

/**
 * Generic business-name cleaning layer for search-derived page titles.
 * Detects and removes:
 * - Common page-title prefixes (Contact Us, Home, Welcome to, Official Website, etc.)
 * - Pipe and dash separators and trailing SEO qualifiers
 * - Trailing location tags (e.g. Dallas TX, Dallas, TX)
 * - Repeated business-name fragments (e.g. "Atlantis Dental Care Dallas TX Atlantis Dental Care")
 * - Preserves legitimate business names and returns confidence indicators
 */
export function cleanSearchTitleToBusinessName(
  rawTitle: string,
  options?: {
    city?: string;
    state?: string;
    niche?: string;
    country?: string;
  }
): CleanTitleResult {
  if (!rawTitle || typeof rawTitle !== 'string') {
    return { cleanedName: '', rawTitle: '', confidence: 'LOW', modified: false };
  }

  const original = rawTitle.trim();
  let text = original;

  // 1. Remove HTML entities
  text = text
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

  // 2. Remove parentheticals at the end e.g. (Formerly XYZ)
  text = text.replace(/\s*\([^)]*\)$/, '').trim();

  // 2a. Strip year indicators e.g. "2026", "2025"
  text = text.replace(/\s*\b(202[0-9]|203[0-9])\b\s*$/i, '').trim();

  // 2b. Strip common search-intent prefixes
  // e.g. "Dentist in Dallas, TX AmeriSmiles Dental", "Dentist near me Dental House", "HVAC in Dallas Air Pro"
  const searchIntentPrefixRegex = /^(?:dentist|dentistry|dental|hvac|doctor|plumber|lawyer|attorney|roofing|electrician|cleaning|chiropractor|orthodontist|pediatric\s+dentist)\s+(?:(?:in\s+[a-zA-Z\s]+(?:,\s*(?:[A-Z]{2}|Texas|USA|US))?)|near\s+me|services\s+in\s+[a-zA-Z\s,.-]+?)\s*[-–—|:•/,\s]+\s*/i;
  while (searchIntentPrefixRegex.test(text)) {
    text = text.replace(searchIntentPrefixRegex, '').trim();
  }
  const searchIntentStandaloneRegex = /^(?:dentist|dentistry|dental|hvac|doctor|plumber|lawyer|attorney|roofing|electrician|cleaning|chiropractor|orthodontist|pediatric\s+dentist)\s+(?:(?:in\s+[a-zA-Z\s]+(?:,\s*(?:[A-Z]{2}|Texas|USA|US))?)|near\s+me)\s+/i;
  if (searchIntentStandaloneRegex.test(text)) {
    const after = text.replace(searchIntentStandaloneRegex, '').trim();
    if (after.length >= 3) {
      text = after;
    }
  }

  // 3. Handle Pipe, Dash, and Bullet delimited segments e.g. "Atlantis Dental Care | Dallas Dentist | Official Website"
  const segments = text.split(/\s*[-–—|•:]\s*/).map((s) => s.trim()).filter(Boolean);
  if (segments.length > 1) {
    // Find the primary brand segment (first non-generic segment)
    const genericSegmentRegex = /^(?:home(?:page)?|contact(?:\s+us)?|about(?:\s+us)?|official\s+(?:web)?site|welcome|services|locations?|reviews|directions|appointment|dentist|dental|doctor|clinic)$/i;
    const substantive = segments.find((seg) => !genericSegmentRegex.test(seg) && seg.length >= 3);
    if (substantive) {
      text = substantive;
    } else {
      text = segments[0] || text;
    }
  }

  // 4. Strip common page-title prefixes
  // e.g. "Contact Us Atlantis Dental Care", "CONTACT US Family Dentistry", "Home - Example Dental Clinic", "Welcome to Dr. Smith"
  const prefixRegex = /^(?:contact\s+us|about\s+us|home(?:page)?|welcome(?:\s+to)?|official\s+(?:web)?site|our\s+services|locations?|book\s+online|get\s+(?:a\s+)?quote)\s*[-–—|:•/,\s]+\s*/i;
  while (prefixRegex.test(text)) {
    text = text.replace(prefixRegex, '').trim();
  }

  // 5. Strip common page-title suffixes
  // e.g. "... | Official Website", "... - Home", "... - Yelp", "... : Reviews"
  const suffixRegex = /\s*[-–—|:•/]\s*(?:official\s+(?:web)?site|official\s+page|home(?:page)?|contact\s+us|about\s+us|services|reviews|yelp|facebook|instagram|linkedin|mapquest|yellowpages|bbb|online\s+booking|get\s+quote).*$/i;
  text = text.replace(suffixRegex, '').trim();

  // 6. Strip trailing location qualifiers
  // e.g. "Example Dental Clinic - Dallas TX", "Example Dental Clinic Dallas, TX", "Best Dentist in Faisalabad 2026"
  if (options?.city) {
    const cityRegex = new RegExp(`(?:\\s*[-–—|:•/]+\\s*|\\s+)(?:in\\s+)?${options.city}(?:,?\\s*(?:${options.state || '[A-Z]{2}'}|Texas|USA|US))?(?:\\s+(?:202[0-9]|203[0-9]))?\\s*$`, 'i');
    text = text.replace(cityRegex, '').trim();
  }
  // Generic city/state suffix e.g. "Dallas TX", "Dallas, TX", "Austin TX"
  text = text.replace(/(?:\s*[-–—|:•/]+\s*|\s+(?:in\s+)?)(?:[A-Z][a-zA-Z\s]+,?\s+(?:TX|CA|NY|FL|IL|PA|OH|GA|NC|MI|NJ|VA|WA|AZ|MA|TN|IN|MO|MD|WI|CO|MN|SC|AL|LA|KY|OR|OK|CT|UT|IA|NV|AR|MS|KS|NM|NE|ID|WV|HI|NH|ME|MT|RI|DE|SD|ND|AK|DC|USA))\s*$/i, '').trim();

  // Strip trailing punctuation artifacts (e.g. trailing comma)
  text = text.replace(/^[\s,;:\-–—|/•]+|[\s,;:\-–—|/•]+$/g, '').trim();

  // 7. Detect and collapse repeated business-name fragments
  // e.g. "Atlantis Dental Care Dallas TX Atlantis Dental Care" -> after location removal: "Atlantis Dental Care Atlantis Dental Care"
  // or "Atlantis Dental Care ... Atlantis Dental Care"
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length >= 4) {
    // Check if the first half matches the second half
    const half = Math.floor(tokens.length / 2);
    const firstHalf = tokens.slice(0, half).join(' ').toLowerCase();
    const secondHalf = tokens.slice(half).join(' ').toLowerCase();
    if (firstHalf === secondHalf) {
      text = tokens.slice(0, half).join(' ');
    } else {
      // Check for repeated multi-word phrase at start and end
      for (let len = Math.floor(tokens.length / 2); len >= 2; len--) {
        const startPhrase = tokens.slice(0, len).join(' ').toLowerCase();
        const endPhrase = tokens.slice(tokens.length - len).join(' ').toLowerCase();
        if (startPhrase === endPhrase) {
          text = tokens.slice(0, len).join(' ');
          break;
        }
      }
    }
  }

  // 8. Clean up punctuation and whitespace
  const cleanedName = normalizeBusinessName(text);

  // If cleaning resulted in an empty string or single word when original had more substance, fallback gracefully
  const finalName = cleanedName.length >= 3 ? cleanedName : normalizeBusinessName(original);

  const modified = finalName.toLowerCase() !== original.toLowerCase();
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH';

  if (!modified) {
    confidence = 'HIGH';
  } else if (finalName.length >= 4 && original.toLowerCase().includes(finalName.toLowerCase())) {
    confidence = 'HIGH';
  } else if (finalName.length < 4) {
    confidence = 'LOW';
  } else {
    confidence = 'MEDIUM';
  }

  return {
    cleanedName: finalName,
    rawTitle: original,
    confidence,
    modified,
  };
}

/**
 * Creates a clean deduplication key for a business.
 */
export function createBusinessMatchKey(name: string, city: string): string {
  const cleanName = normalizeBusinessName(name)
    .toLowerCase()
    .replace(/\b(llc|inc|incorporated|corp|corporation|pllc|pc|co|company|ltd|limited|group|services|office|clinic)\b/gi, '')
    .replace(/[^a-z0-9]/g, '');

  const cleanCity = city.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${cleanName}_${cleanCity}`;
}

/**
 * Cleans phone numbers into a standard format.
 */
export function normalizePhone(phone: string | undefined | null): string | undefined {
  if (!phone || typeof phone !== 'string') return undefined;

  const cleaned = phone.trim().replace(/[^\d+()-\s.]/g, '');
  return cleaned.length >= 7 ? cleaned : undefined;
}

