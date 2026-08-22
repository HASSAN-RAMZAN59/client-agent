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
