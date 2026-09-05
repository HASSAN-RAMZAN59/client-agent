import { WebsiteType, WebsiteClassificationResult, OfficialWebsiteConfidence } from '../../types/index.js';
import { isExcludedDirectoryDomain } from './excluded-domains.js';

const SOCIAL_DOMAINS = new Set([
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'youtube.com',
  'tiktok.com',
  'pinterest.com',
]);

const MARKETPLACE_DOMAINS = new Set([
  'amazon.com',
  'ebay.com',
  'etsy.com',
  'olx.com.pk',
  'olx.com',
  'zameen.com',
  'pakwheels.com',
  'craigslist.org',
]);

/**
 * Classifies a website URL into business website types and computes evidence.
 */
export function classifyWebsite(
  url: string | null | undefined,
  businessName?: string,
  city?: string
): WebsiteClassificationResult {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return {
      url: '',
      domain: '',
      type: 'UNKNOWN',
      confidence: 'UNKNOWN',
      evidence: ['No URL provided'],
      isAuthoritative: false,
      isOfficialSite: false,
    };
  }

  const cleanUrl = url.trim();
  let domain = cleanUrl.toLowerCase();
  let pathname = '';

  try {
    const parsed = new URL(cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`);
    domain = parsed.hostname.toLowerCase();
    pathname = parsed.pathname.toLowerCase();
  } catch {
    // URL parsing fallback
    const noProto = cleanUrl.replace(/^https?:\/\//i, '');
    const slashIdx = noProto.indexOf('/');
    if (slashIdx !== -1) {
      domain = noProto.slice(0, slashIdx).toLowerCase();
      pathname = noProto.slice(slashIdx).toLowerCase();
    } else {
      domain = noProto.toLowerCase();
    }
  }

  if (domain.startsWith('www.')) {
    domain = domain.slice(4);
  }

  const evidence: string[] = [];

  // 1. Social Profile
  for (const social of SOCIAL_DOMAINS) {
    if (domain === social || domain.endsWith(`.${social}`)) {
      evidence.push(`Domain matches known social network (${social})`);
      return {
        url: cleanUrl,
        domain,
        type: 'SOCIAL_PROFILE',
        confidence: 'LOW',
        evidence,
        isAuthoritative: false,
        isOfficialSite: false,
      };
    }
  }

  // 2. Marketplace
  for (const market of MARKETPLACE_DOMAINS) {
    if (domain === market || domain.endsWith(`.${market}`)) {
      evidence.push(`Domain matches known marketplace (${market})`);
      return {
        url: cleanUrl,
        domain,
        type: 'MARKETPLACE',
        confidence: 'LOW',
        evidence,
        isAuthoritative: false,
        isOfficialSite: false,
      };
    }
  }

  // 3. Known Excluded Directory Domain
  const isExcluded = isExcludedDirectoryDomain(cleanUrl);
  if (isExcluded) {
    evidence.push(`Domain matches excluded directory/aggregator list (${domain})`);

    // Check if it looks like an aggregator category/listing page
    const isAggregator =
      pathname.includes('/doctors/') ||
      pathname.includes('/dentist/') ||
      pathname.includes('/hospitals/') ||
      pathname.includes('/department/') ||
      pathname.includes('/clinics/') ||
      pathname.includes('/category/') ||
      pathname.includes('/dental-clinics') ||
      domain.includes('marham') ||
      domain.includes('apkamuaalij') ||
      domain.includes('ebizpk') ||
      domain.includes('health360');

    if (isAggregator) {
      evidence.push(`URL path or domain structure indicates directory aggregator listing (${pathname})`);
      return {
        url: cleanUrl,
        domain,
        type: 'AGGREGATOR',
        confidence: 'LOW',
        evidence,
        isAuthoritative: false,
        isOfficialSite: false,
      };
    }

    return {
      url: cleanUrl,
      domain,
      type: 'DIRECTORY_LISTING',
      confidence: 'LOW',
      evidence,
      isAuthoritative: false,
      isOfficialSite: false,
    };
  }

  // 4. Path-based directory detection on any domain
  const dirPatterns = [
    '/doctors/',
    '/dentist/',
    '/dentists/',
    '/hospitals/',
    '/department/',
    '/clinics/',
    '/categories/',
    '/category/',
    '/listings/',
    '/directory/',
    '/find-a-',
  ];

  for (const pattern of dirPatterns) {
    if (pathname.includes(pattern)) {
      evidence.push(`URL path contains directory listing pattern: ${pattern}`);
      return {
        url: cleanUrl,
        domain,
        type: 'DIRECTORY_LISTING',
        confidence: 'LOW',
        evidence,
        isAuthoritative: false,
        isOfficialSite: false,
      };
    }
  }

  // 5. Official Business Site candidate evaluation
  if (businessName) {
    const cleanBizTokens = businessName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !['the', 'and', 'clinic', 'center', 'care', 'dental', 'dentist'].includes(t));

    const domainBase = domain.replace(/\.[a-z]{2,}(?:\.[a-z]{2})?$/, '').replace(/[^a-z0-9]/g, '');

    const matchingTokens = cleanBizTokens.filter((token) => domainBase.includes(token));

    if (cleanBizTokens.length > 0 && matchingTokens.length > 0) {
      evidence.push(`Domain "${domain}" matches business brand tokens: [${matchingTokens.join(', ')}]`);
      return {
        url: cleanUrl,
        domain,
        type: 'OFFICIAL_BUSINESS_SITE',
        confidence: matchingTokens.length >= 2 || matchingTokens[0].length >= 5 ? 'HIGH' : 'MEDIUM',
        evidence,
        isAuthoritative: true,
        isOfficialSite: true,
      };
    }
  }

  // If domain is clean and not excluded, but no strong token match
  evidence.push(`Domain "${domain}" is not in excluded directory list, but lacks distinctive brand token verification`);
  return {
    url: cleanUrl,
    domain,
    type: 'OFFICIAL_BUSINESS_SITE',
    confidence: 'MEDIUM',
    evidence,
    isAuthoritative: true,
    isOfficialSite: true,
  };
}
