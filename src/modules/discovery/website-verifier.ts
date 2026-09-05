import { normalizeUrl, extractCanonicalDomain, normalizeBusinessName } from './normalizer.js';
import { WebsiteReachabilityStatus, OfficialWebsiteConfidence } from '../../types/index.js';
import { classifyWebsite } from './website-classifier.js';
import { logger } from '../../utils/logger.js';

export interface WebsiteReachabilityResult {
  rawUrl?: string;
  normalizedUrl?: string;
  finalUrl?: string;
  reachable: boolean;
  statusCode?: number;
  status: WebsiteReachabilityStatus;
  confidence: OfficialWebsiteConfidence;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 6000;

const PROBE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (Compliance-Research/1.0)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

/**
 * Calculates confidence that a given website is the official domain of the business.
 */
export function calculateOfficialWebsiteConfidence(
  businessName: string,
  rawUrl?: string | null
): OfficialWebsiteConfidence {
  if (!rawUrl || rawUrl.trim().length === 0) return 'UNKNOWN';

  // If website is classified as directory, aggregator, marketplace, or social, confidence is LOW
  const classification = classifyWebsite(rawUrl, businessName);
  if (classification.type !== 'OFFICIAL_BUSINESS_SITE') {
    return 'LOW';
  }

  const domain = extractCanonicalDomain(rawUrl);
  if (!domain) return 'UNKNOWN';

  const cleanName = normalizeBusinessName(businessName)
    .toLowerCase()
    .replace(/\b(llc|inc|corp|pllc|pc|co|ltd)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

  // 1. Flag free web builders or generic platforms as LOW confidence first
  const lowConfidenceHosts = ['facebook.com', 'instagram.com', 'wixsite.com', 'wordpress.com', 'blogspot.com', 'weebly.com', 'sites.google.com'];
  if (lowConfidenceHosts.some((h) => domain.includes(h))) {
    return 'LOW';
  }

  // 2. Direct name match in domain (e.g., "Apex Dental" in "apexdental.com")
  const domainBase = domain.split('.')[0] || '';
  if (domainBase === cleanName || domain.includes(cleanName)) {
    return 'HIGH';
  }

  // 3. High overlap between key words in business name and domain
  const words = normalizeBusinessName(businessName)
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const matchedWords = words.filter((w) => domain.includes(w));
  if (matchedWords.length >= 2 || (words.length === 1 && matchedWords.length === 1)) {
    return 'HIGH';
  }

  if (matchedWords.length === 1) {
    return 'MEDIUM';
  }

  return 'MEDIUM';
}

/**
 * Probes website availability and classifies reachability status without treating temporary blocks/timeouts as non-existent sites.
 */
export async function verifyWebsiteReachability(
  rawUrl: string | undefined | null,
  businessName: string = '',
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<WebsiteReachabilityResult> {
  const log = logger.child('WebsiteVerifier');

  if (!rawUrl || rawUrl.trim().length === 0) {
    return {
      rawUrl: '',
      reachable: false,
      status: 'NO_WEBSITE_FOUND',
      confidence: 'UNKNOWN',
    };
  }

  const normalized = normalizeUrl(rawUrl);
  if (!normalized) {
    return {
      rawUrl,
      reachable: false,
      status: 'WEBSITE_UNREACHABLE',
      confidence: 'LOW',
      error: 'Invalid or malformed URL syntax',
    };
  }

  const confidence = calculateOfficialWebsiteConfidence(businessName, normalized);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      // Try HEAD request first for speed
      response = await fetch(normalized, {
        method: 'HEAD',
        headers: PROBE_HEADERS,
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch {
      // Fallback to GET on HEAD rejection
      response = await fetch(normalized, {
        method: 'GET',
        headers: PROBE_HEADERS,
        redirect: 'follow',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const finalUrl = normalizeUrl(response.url) || normalized;
    const statusCode = response.status;

    let status: WebsiteReachabilityStatus = 'UNKNOWN';
    let isReachable = false;

    if (statusCode >= 200 && statusCode < 400) {
      status = 'WEBSITE_REACHABLE';
      isReachable = true;
    } else if (statusCode === 403 || statusCode === 429 || statusCode === 401) {
      // Cloudflare/WAF or bot-check on probe request; website exists but blocked probe
      status = 'WEBSITE_BLOCKED';
      isReachable = false;
    } else if (statusCode >= 400 && statusCode < 500) {
      status = 'WEBSITE_UNREACHABLE';
      isReachable = false;
    } else if (statusCode >= 500) {
      status = 'WEBSITE_UNREACHABLE';
      isReachable = false;
    }

    return {
      rawUrl,
      normalizedUrl: normalized,
      finalUrl,
      reachable: isReachable,
      statusCode,
      status,
      confidence,
      error: isReachable ? undefined : `HTTP status ${statusCode}`,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.debug(`Reachability probe exception for ${normalized}: ${errorMessage}`);

    const isTimeout = errorMessage.toLowerCase().includes('aborted') || errorMessage.toLowerCase().includes('timeout');

    return {
      rawUrl,
      normalizedUrl: normalized,
      reachable: false,
      status: isTimeout ? 'WEBSITE_TIMEOUT' : 'WEBSITE_UNREACHABLE',
      confidence,
      error: isTimeout ? 'Connection timed out' : errorMessage,
    };
  }
}
