export interface DetectedContactPage {
  url: string;
  type: 'contact' | 'about' | 'booking';
  priority: number; // 1 = contact, 2 = booking, 3 = about
}

const CONTACT_PATTERNS = [
  /\/contact(?:-us)?(?:\/|\.html|\.php)?$/i,
  /\/contact(?:-us)?\?/i,
  /\/get-in-touch/i,
  /\/reach-us/i,
  /\/location(?:s)?/i,
];

const BOOKING_PATTERNS = [
  /\/book(?:ing|-now|-online)?(?:\/|\.html|\.php)?$/i,
  /\/appointment(?:s)?(?:\/|\.html|\.php)?$/i,
  /\/request-quote/i,
  /\/schedule/i,
];

const ABOUT_PATTERNS = [
  /\/about(?:-us|-the-practice|-our-team|-our-doctors)?(?:\/|\.html|\.php)?$/i,
  /\/team/i,
  /\/doctors/i,
];

export function detectContactPages(
  homepageHtml: string,
  baseUrl: string,
  maxPages: number = 3
): DetectedContactPage[] {
  let baseHostname = '';
  try {
    const baseObj = new URL(baseUrl);
    baseHostname = baseObj.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return [];
  }

  const detected: Map<string, DetectedContactPage> = new Map();
  const linkRegex = /<a\s+[^>]*href=["']([^"'#]+)["'][^>]*>(.*?)<\/a>/gis;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(homepageHtml)) !== null) {
    const rawHref = match[1]?.trim();
    const anchorText = match[2]?.replace(/<[^>]*>/g, '').trim() || '';

    if (!rawHref || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
      continue;
    }

    try {
      const resolvedUrl = new URL(rawHref, baseUrl);
      const targetHost = resolvedUrl.hostname.replace(/^www\./i, '').toLowerCase();

      // Must be same root domain or subdomain
      if (targetHost !== baseHostname && !targetHost.endsWith(`.${baseHostname}`)) {
        continue;
      }

      const pathname = resolvedUrl.pathname.toLowerCase();
      const combined = `${pathname} ${anchorText.toLowerCase()}`;

      // Check Contact Page
      if (
        CONTACT_PATTERNS.some((p) => p.test(pathname)) ||
        /\b(contact|contact us|get in touch|reach us)\b/i.test(anchorText)
      ) {
        const cleanUrl = resolvedUrl.origin + resolvedUrl.pathname;
        if (!detected.has(cleanUrl)) {
          detected.set(cleanUrl, { url: cleanUrl, type: 'contact', priority: 1 });
        }
        continue;
      }

      // Check Booking Page
      if (
        BOOKING_PATTERNS.some((p) => p.test(pathname)) ||
        /\b(book now|book appointment|request appointment|schedule online)\b/i.test(anchorText)
      ) {
        const cleanUrl = resolvedUrl.origin + resolvedUrl.pathname;
        if (!detected.has(cleanUrl)) {
          detected.set(cleanUrl, { url: cleanUrl, type: 'booking', priority: 2 });
        }
        continue;
      }

      // Check About Page
      if (
        ABOUT_PATTERNS.some((p) => p.test(pathname)) ||
        /\b(about us|about our team|our practice|meet the team)\b/i.test(anchorText)
      ) {
        const cleanUrl = resolvedUrl.origin + resolvedUrl.pathname;
        if (!detected.has(cleanUrl)) {
          detected.set(cleanUrl, { url: cleanUrl, type: 'about', priority: 3 });
        }
        continue;
      }
    } catch {
      // Invalid URL skipped
    }
  }

  // Sort by priority (Contact > Booking > About) and slice up to maxPages
  return Array.from(detected.values())
    .sort((a, b) => a.priority - b.priority)
    .slice(0, maxPages);
}
