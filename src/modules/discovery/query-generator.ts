import { getMarketProfile } from '../../config/markets.js';
import { safetyControls } from '../../config/safety.js';

export interface DiscoveryQueryVariant {
  query: string;
  templateType: 'OFFICIAL_WEBSITE' | 'CONTACT' | 'BOOKING' | 'QUOTE' | 'LOCATION_NICHE';
  priority: number;
}

export interface QueryGenerationOptions {
  niche: string;
  city: string;
  country?: string;
  state?: string;
  maxQueries?: number;
}

/**
 * Generates structured, high-intent discovery query variants for public search fallback.
 */
export function generateDiscoveryQueries(options: QueryGenerationOptions): DiscoveryQueryVariant[] {
  const policy = safetyControls.getPolicy();
  const maxQueries = options.maxQueries
    ? Math.min(options.maxQueries, policy.maxDiscoveryQueriesPerRun)
    : policy.maxDiscoveryQueriesPerRun;

  const market = getMarketProfile(options.country);
  const city = options.city.trim();
  const niche = options.niche.trim();
  const statePart = options.state ? ` ${options.state.trim()}` : '';

  const locationName = `${city}${statePart}`;

  // Structured query intent templates in priority order
  const candidates: Array<{ query: string; templateType: DiscoveryQueryVariant['templateType']; priority: number }> = [
    // 1. Official website intent
    {
      query: `"${niche}" "${locationName}" official website`,
      templateType: 'OFFICIAL_WEBSITE',
      priority: 1,
    },
    // 2. Direct contact intent
    {
      query: `"${niche}" "${locationName}" contact us`,
      templateType: 'CONTACT',
      priority: 2,
    },
    // 3. Appointment / Booking intent
    {
      query: `"${niche}" "${locationName}" book appointment online`,
      templateType: 'BOOKING',
      priority: 3,
    },
    // 4. Quote / Services intent
    {
      query: `"${niche}" "${locationName}" get quote estimate`,
      templateType: 'QUOTE',
      priority: 4,
    },
    // 5. Clean local business query
    {
      query: `"${niche}" in "${locationName}" ${market.countryCode !== 'GLOBAL' ? market.countryName : ''}`.trim(),
      templateType: 'LOCATION_NICHE',
      priority: 5,
    },
  ];

  // Filter unique queries and clamp to configured maximum
  const seenQueries = new Set<string>();
  const results: DiscoveryQueryVariant[] = [];

  for (const item of candidates) {
    if (results.length >= maxQueries) break;
    const cleanQuery = item.query.replace(/\s+/g, ' ').trim();
    if (!seenQueries.has(cleanQuery)) {
      seenQueries.add(cleanQuery);
      results.push({
        query: cleanQuery,
        templateType: item.templateType,
        priority: item.priority,
      });
    }
  }

  return results;
}
