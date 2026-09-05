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

  // South Asian & Regional Aggregators & Portals
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
  'marham.pk',
  'apkamuaalij.com',
  'ebizpk.com',
  'health360.pk',
  'oladoc.com',
  'shifaam.com',
  'instacare.pk',
  'practo.com',
  'dunya.com',
  'pakistanistores.com',
  'shafaf.pk',
  'findout.pk',
  'businesslist.pk',
  'pakistanbusinessdirectory.com',
  'lahore.com.pk',
  'karachi.com.pk',
  'islamabad.com.pk',
  'faisalabad.com.pk',
  'nicelocal.com',
  'city-data.com',
  'cylex.us.com',
  'cylex-uk.co.uk',
  'afh.com.pk',

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
  let pathname = '';

  // Strip protocol and extract hostname + pathname if full URL was provided
  try {
    if (hostname.startsWith('http://') || hostname.startsWith('https://')) {
      const parsed = new URL(hostname);
      hostname = parsed.hostname.toLowerCase();
      pathname = parsed.pathname.toLowerCase();
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

  // 2. Suffix / Subdomain Match (e.g. "faisalabad.ebizpk.com" matches "ebizpk.com")
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

  // 4. Common URL Path Aggregator Patterns
  const directoryPathPatterns = [
    '/doctors/',
    '/doctor/',
    '/dentists/',
    '/dentist/',
    '/hospitals/',
    '/hospital/',
    '/clinics/',
    '/department/',
    '/departments/',
    '/category/',
    '/categories/',
    '/find/',
    '/listing/',
    '/listings/',
    '/directory/',
    '/top-10-',
    '/best-',
    '/dental-clinics-',
  ];

  const fullPathOrUrl = (pathname || urlOrDomain).toLowerCase();
  for (const pattern of directoryPathPatterns) {
    if (fullPathOrUrl.includes(pattern)) {
      // If the domain is already an aggregator or matches directory characteristics
      if (
        hostname.includes('directory') ||
        hostname.includes('placedigger') ||
        hostname.includes('top10') ||
        hostname.includes('localsearch') ||
        hostname.includes('city-guide') ||
        hostname.includes('ebiz') ||
        hostname.includes('muaalij') ||
        hostname.includes('marham') ||
        hostname.includes('health') ||
        hostname.includes('portal')
      ) {
        return true;
      }
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
