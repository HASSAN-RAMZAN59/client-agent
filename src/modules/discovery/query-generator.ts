import { getMarketProfile, normalizeCountry } from '../../config/markets.js';
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
 * Generates natural location combinations (city, city+state, city+country, city+state+country)
 * without quoting the full combined location as one rigid mandatory exact phrase.
 */
export function formatLocationVariants(city: string, state?: string, countryName?: string): {
  cityOnly: string;
  cityState: string;
  cityCountry: string;
  cityStateCountry: string;
} {
  const cleanCity = city.trim();
  const cleanState = state?.trim();
  const cleanCountry = countryName && countryName !== 'Global' ? countryName.trim() : undefined;

  const cityOnly = cleanCity;
  const cityState = cleanState ? `${cleanCity} ${cleanState}` : cleanCity;
  const cityCountry = cleanCountry ? `${cleanCity} ${cleanCountry}` : cleanCity;
  const cityStateCountry = cleanState && cleanCountry
    ? `${cleanCity} ${cleanState} ${cleanCountry}`
    : cleanCountry
    ? `${cleanCity} ${cleanCountry}`
    : cityState;

  return {
    cityOnly,
    cityState,
    cityCountry,
    cityStateCountry,
  };
}

/**
 * Generates structured, high-intent discovery query variants for public search fallback.
 * Produces natural search queries without over-restrictive quotes on multi-word localities.
 */
export function generateDiscoveryQueries(options: QueryGenerationOptions): DiscoveryQueryVariant[] {
  const policy = safetyControls.getPolicy();
  const maxQueries = options.maxQueries
    ? Math.min(options.maxQueries, policy.maxDiscoveryQueriesPerRun)
    : policy.maxDiscoveryQueriesPerRun;

  const { name: countryName } = normalizeCountry(options.country);
  const city = options.city.trim();
  const niche = options.niche.trim();
  const state = options.state?.trim();

  const { cityOnly, cityState, cityCountry, cityStateCountry } = formatLocationVariants(
    city,
    state,
    countryName
  );

  // Structured query intent templates in priority order
  const candidates: Array<{ query: string; templateType: DiscoveryQueryVariant['templateType']; priority: number }> = [
    // 1. Official website intent: e.g. "dentist" Dallas Texas official website
    {
      query: `"${niche}" ${cityState} official website`,
      templateType: 'OFFICIAL_WEBSITE',
      priority: 1,
    },
    // 2. Direct contact intent: e.g. "dentist" Faisalabad Pakistan contact
    {
      query: `"${niche}" ${cityCountry} contact`,
      templateType: 'CONTACT',
      priority: 2,
    },
    // 3. Appointment / Booking intent: e.g. "dentist" Toronto Ontario book appointment online
    {
      query: `"${niche}" ${cityState} book appointment online`,
      templateType: 'BOOKING',
      priority: 3,
    },
    // 4. Quote / Services intent: e.g. "dentist" Sydney NSW quote estimate
    {
      query: `"${niche}" ${cityState} get quote estimate`,
      templateType: 'QUOTE',
      priority: 4,
    },
    // 5. Clean local business query: e.g. "dentist" in Dallas Texas / Faisalabad Punjab Pakistan
    {
      query: `"${niche}" in ${cityStateCountry}`,
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
