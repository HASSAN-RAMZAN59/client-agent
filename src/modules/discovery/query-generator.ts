import { getMarketProfile, normalizeCountry } from '../../config/markets.js';
import { safetyControls } from '../../config/safety.js';
import { normalizeNiche } from './niche-normalizer.js';

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
 * Normalizes niche to canonical form and expands into natural aliases without raw slashes or combined punctuation.
 */
export function generateDiscoveryQueries(options: QueryGenerationOptions): DiscoveryQueryVariant[] {
  const policy = safetyControls.getPolicy();
  const maxQueries = options.maxQueries
    ? Math.min(options.maxQueries, policy.maxDiscoveryQueriesPerRun)
    : policy.maxDiscoveryQueriesPerRun;

  const { name: countryName } = normalizeCountry(options.country);
  const city = options.city.trim();
  const state = options.state?.trim();

  // Canonical niche normalization: expands raw inputs into clean primary term & natural aliases
  const rawClean = options.niche.trim();
  const hasDelimiters = /[\/|,]/.test(rawClean);
  const nicheDef = normalizeNiche(options.niche);

  // If raw input has delimiters (e.g. "dental /dentist"), use canonical primary term
  // If raw input is already a single clean string (e.g. "Dentist" or "HVAC"), preserve its exact text
  const primaryAlias = hasDelimiters
    ? nicheDef.primaryQueryTerm || 'business'
    : rawClean;

  const aliases = nicheDef.aliases.length > 0 ? nicheDef.aliases : [primaryAlias];
  const distinctSecondaryAliases = aliases.filter(
    (a) => a.toLowerCase() !== primaryAlias.toLowerCase()
  );

  const alias1 = distinctSecondaryAliases[0] || primaryAlias;
  const alias2 = distinctSecondaryAliases[1] || alias1;
  const alias3 = distinctSecondaryAliases[2] || alias2;

  const { cityOnly, cityState, cityCountry, cityStateCountry } = formatLocationVariants(
    city,
    state,
    countryName
  );

  // Structured query intent templates in priority order using clean natural aliases
  const candidates: Array<{ query: string; templateType: DiscoveryQueryVariant['templateType']; priority: number }> = [
    // 1. Official website intent (primary canonical alias)
    {
      query: `"${primaryAlias}" ${cityState} official website`,
      templateType: 'OFFICIAL_WEBSITE',
      priority: 1,
    },
    // 2. Direct contact intent (primary canonical alias)
    {
      query: `"${primaryAlias}" ${cityCountry} contact`,
      templateType: 'CONTACT',
      priority: 2,
    },
    // 3. Appointment / Booking intent (expanded with secondary natural alias)
    {
      query: `"${alias1}" ${cityState} book appointment online`,
      templateType: 'BOOKING',
      priority: 3,
    },
    // 4. Quote / Services intent (expanded with tertiary natural alias)
    {
      query: `"${alias2}" ${cityState} get quote estimate`,
      templateType: 'QUOTE',
      priority: 4,
    },
    // 5. Clean local business query (expanded with natural alias)
    {
      query: `"${alias1}" in ${cityStateCountry}`,
      templateType: 'LOCATION_NICHE',
      priority: 5,
    },
    // 6. Secondary alias official website intent
    {
      query: `"${alias1}" ${cityState} official website`,
      templateType: 'OFFICIAL_WEBSITE',
      priority: 6,
    },
    // 7. Secondary alias contact query
    {
      query: `"${primaryAlias}" ${cityCountry} contact`,
      templateType: 'CONTACT',
      priority: 7,
    },
    // 8. Tertiary alias local query
    {
      query: `"${alias3}" in ${cityStateCountry}`,
      templateType: 'LOCATION_NICHE',
      priority: 8,
    },
    // 9. Secondary alias in city country
    {
      query: `"${alias2}" in ${cityCountry}`,
      templateType: 'LOCATION_NICHE',
      priority: 9,
    },
    // 10. Quaternary alias services query
    {
      query: `"${alias3}" ${cityState} services`,
      templateType: 'QUOTE',
      priority: 10,
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
