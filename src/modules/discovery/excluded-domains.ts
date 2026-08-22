import { config } from '../../config/env.js';

/**
 * Curated list of directory, aggregator, review, franchise portal, job board,
 * and listicle domains to filter out of organic discovery search results.
 */
export const DEFAULT_EXCLUDED_DOMAINS = new Set<string>([
  // Global & North American Directories & Portals
  'yelp.com',
  'yellowpages.com',
  'yellowpages.ca',
  'superpages.com',
  'mapquest.com',
  'tripadvisor.com',
  'bbb.org',
  'angi.com',
  'thumbtack.com',
  'homeadvisor.com',
  'healthgrades.com',
  'zocdoc.com',
  'vitals.com',
  'opencare.com',
  'avvo.com',
  'lawyers.com',
  'attorneys.org',
  'justia.com',
  'findlaw.com',
  'lawcrossing.com',
  'martindale.com',
  'clutch.co',
  'goodfirms.co',
  'upcity.com',
  'expertise.com',
  'bark.com',
  'houzz.com',
  'opentable.com',
  'resy.com',
  'grubhub.com',
  'doordash.com',
  'ubereats.com',
  'postmates.com',
  'seamless.com',
  'menupages.com',
  'restaurantguru.com',
  'allmenus.com',
  'zomato.com',

  // Australian & UK Directories
  'localsearch.com.au',
  'wordofmouth.com.au',
  'truelocal.com.au',
  'yellowpages.com.au',
  'yell.com',
  'thomsonlocal.com',
  'checkatrade.com',
  'mybuilder.com',
  'trustpilot.com',

  // South Asian & Regional Aggregators
  'placedigger.com',
  'pk.placedigger.com',
  'dealer.com.pk',
  'top10place.com',
  'pk.top10place.com',
  'autoyas.com',
  'foodhutti.com',
  'restaurantmenu.com.pk',
  'pakwheels.com',
  'olx.com.pk',
  'zameen.com',
  'mustakbil.com',
  'rozee.pk',

  // Social Networks, Generic Platforms, Job Boards & Web Builders
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'youtube.com',
  'tiktok.com',
  'pinterest.com',
  'wikipedia.org',
  'wikimedia.org',
  'google.com',
  'duckduckgo.com',
  'bing.com',
  'yahoo.com',
  'glassdoor.com',
  'indeed.com',
  'ziprecruiter.com',
  'monster.com',
  'simplyhired.com',
  'wix.com',
  'squarespace.com',
  'weebly.com',
  'wordpress.com',
  'godaddy.com',
]);

/**
 * Checks whether a given URL, domain, or hostname belongs to an excluded directory/aggregator.
 */
export function isExcludedDirectoryDomain(
  urlOrDomain: string | undefined | null,
  additionalExcluded?: string[]
): boolean {
  if (!urlOrDomain || typeof urlOrDomain !== 'string') return true;

  let hostname = urlOrDomain.toLowerCase().trim();

  // Strip protocol and path if full URL was provided
  try {
    if (hostname.startsWith('http://') || hostname.startsWith('https://')) {
      const parsed = new URL(hostname);
      hostname = parsed.hostname.toLowerCase();
    }
  } catch {
    // If URL parsing fails, continue with normalized string
  }

  // Remove leading www.
  if (hostname.startsWith('www.')) {
    hostname = hostname.slice(4);
  }

  // 1. Direct Set Match
  if (DEFAULT_EXCLUDED_DOMAINS.has(hostname)) {
    return true;
  }

  // 2. Suffix / Subdomain Match (e.g. "pk.placedigger.com" matches "placedigger.com")
  for (const excluded of DEFAULT_EXCLUDED_DOMAINS) {
    if (hostname === excluded || hostname.endsWith(`.${excluded}`)) {
      return true;
    }
  }

  // 3. User / Environment Configured Exclusions
  const envExcluded = config.DISCOVERY_EXCLUDED_DOMAINS
    ? config.DISCOVERY_EXCLUDED_DOMAINS.split(',').map((d) => d.trim().toLowerCase())
    : [];

  const combinedCustom = [...envExcluded, ...(additionalExcluded || [])];
  for (const custom of combinedCustom) {
    if (!custom) continue;
    const cleanCustom = custom.replace(/^www\./, '');
    if (hostname === cleanCustom || hostname.endsWith(`.${cleanCustom}`)) {
      return true;
    }
  }

  // 4. Common URL Path Aggregator Patterns (e.g. /find/, /directory/, /best-10/, /top-10/)
  if (
    urlOrDomain.includes('/category/') ||
    urlOrDomain.includes('/find/') ||
    urlOrDomain.includes('/listing/') ||
    urlOrDomain.includes('/top-10-') ||
    urlOrDomain.includes('/best-')
  ) {
    // If domain also has aggregator keywords
    if (
      hostname.includes('directory') ||
      hostname.includes('placedigger') ||
      hostname.includes('top10') ||
      hostname.includes('localsearch') ||
      hostname.includes('city-guide')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Returns all active default excluded domains.
 */
export function getAllExcludedDomains(): string[] {
  return Array.from(DEFAULT_EXCLUDED_DOMAINS);
}
