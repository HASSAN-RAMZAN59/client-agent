/**
 * Reusable Market Configuration System for Multi-Country & Multi-Niche Operations
 */

export interface MarketNicheMapping {
  niche: string;
  osmTags: string[];
  searchKeywords: string[];
}

export interface CountryMarketProfile {
  countryCode: string; // ISO 3166-1 alpha-2 (e.g., 'US', 'CA', 'GB', 'AU', 'PK')
  countryName: string;
  dialCode: string; // E.164 dialing code (e.g., '+1', '+44', '+61', '+92')
  phonePattern: RegExp;
  phoneExample: string;
  primaryTlds: string[]; // e.g. ['.com', '.org', '.net'] for US, ['.ca'] for CA
  administrativeDivisions: string[]; // States / Provinces / Territories
  overpassAreaAdminLevel: string; // Regex for Overpass admin_level (e.g. '^[4-8]$')
  defaultQueryTemplates: string[];
  nicheMappings: Record<string, string[]>;
}

export const COUNTRY_MARKET_PROFILES: Record<string, CountryMarketProfile> = {
  US: {
    countryCode: 'US',
    countryName: 'United States',
    dialCode: '+1',
    phonePattern: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]\d{4}\b/,
    phoneExample: '+1 (555) 123-4567',
    primaryTlds: ['.com', '.org', '.net', '.us', '.biz', '.io'],
    administrativeDivisions: [
      'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
      'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
      'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
      'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
      'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
    ],
    overpassAreaAdminLevel: '^[4-8]$',
    defaultQueryTemplates: [
      '"{niche}" "{city}" official website',
      '"{niche}" "{city}" contact',
      '"{niche}" "{city}" book appointment',
      '"{niche}" "{city}" quote estimate',
    ],
    nicheMappings: {
      dentist: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
      doctor: ['["amenity"="doctors"]', '["amenity"="clinic"]', '["healthcare"="doctor"]'],
      restaurant: ['["amenity"="restaurant"]', '["amenity"="cafe"]'],
      cafe: ['["amenity"="cafe"]', '["amenity"="restaurant"]'],
      hvac: ['["craft"="hvac"]', '["craft"="electrician"]', '["craft"="plumber"]'],
      plumber: ['["craft"="plumber"]', '["trade"="plumber"]'],
      lawyer: ['["office"="lawyer"]', '["office"="legal"]'],
      roofing: ['["craft"="roofer"]', '["craft"="construction"]'],
      autodealership: ['["shop"="car"]', '["shop"="car_repair"]'],
      realestate: ['["office"="estate_agent"]', '["office"="real_estate"]'],
      gym: ['["leisure"="fitness_centre"]', '["leisure"="sports_centre"]'],
      salon: ['["shop"="hairdresser"]', '["shop"="beauty"]'],
      cleaning: ['["craft"="cleaning"]', '["office"="cleaning"]'],
      software: ['["office"="it"]', '["office"="company"]', '["office"="telecommunication"]'],
    },
  },

  CA: {
    countryCode: 'CA',
    countryName: 'Canada',
    dialCode: '+1',
    phonePattern: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]\d{4}\b/,
    phoneExample: '+1 (416) 555-0123',
    primaryTlds: ['.ca', '.com', '.org', '.net'],
    administrativeDivisions: [
      'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
    ],
    overpassAreaAdminLevel: '^[4-8]$',
    defaultQueryTemplates: [
      '"{niche}" "{city}" official website',
      '"{niche}" "{city}" contact',
      '"{niche}" "{city}" book appointment',
      '"{niche}" "{city}" quote',
    ],
    nicheMappings: {
      dentist: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
      doctor: ['["amenity"="doctors"]', '["healthcare"="doctor"]'],
      restaurant: ['["amenity"="restaurant"]', '["amenity"="cafe"]'],
      cafe: ['["amenity"="cafe"]'],
      hvac: ['["craft"="hvac"]', '["craft"="electrician"]'],
      plumber: ['["craft"="plumber"]'],
      lawyer: ['["office"="lawyer"]', '["office"="legal"]'],
      roofing: ['["craft"="roofer"]'],
      autodealership: ['["shop"="car"]'],
      realestate: ['["office"="estate_agent"]'],
      gym: ['["leisure"="fitness_centre"]'],
      salon: ['["shop"="hairdresser"]', '["shop"="beauty"]'],
      cleaning: ['["craft"="cleaning"]'],
      software: ['["office"="it"]', '["office"="company"]'],
    },
  },

  GB: {
    countryCode: 'GB',
    countryName: 'United Kingdom',
    dialCode: '+44',
    phonePattern: /(?:\+?44[-.\s]?|0)(?:\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4})\b/,
    phoneExample: '+44 20 7946 0958',
    primaryTlds: ['.co.uk', '.uk', '.com', '.org.uk'],
    administrativeDivisions: ['England', 'Scotland', 'Wales', 'Northern Ireland', 'London', 'Greater London'],
    overpassAreaAdminLevel: '^[4-8]$',
    defaultQueryTemplates: [
      '"{niche}" "{city}" official website',
      '"{niche}" "{city}" contact',
      '"{niche}" "{city}" booking enquiries',
      '"{niche}" "{city}" quote',
    ],
    nicheMappings: {
      dentist: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
      doctor: ['["amenity"="doctors"]', '["healthcare"="doctor"]'],
      restaurant: ['["amenity"="restaurant"]', '["amenity"="pub"]', '["amenity"="cafe"]'],
      cafe: ['["amenity"="cafe"]', '["amenity"="restaurant"]'],
      hvac: ['["craft"="hvac"]', '["craft"="electrician"]'],
      plumber: ['["craft"="plumber"]'],
      lawyer: ['["office"="lawyer"]', '["office"="solicitor"]', '["office"="legal"]'],
      roofing: ['["craft"="roofer"]'],
      autodealership: ['["shop"="car"]'],
      realestate: ['["office"="estate_agent"]'],
      gym: ['["leisure"="fitness_centre"]'],
      salon: ['["shop"="hairdresser"]', '["shop"="beauty"]'],
      cleaning: ['["craft"="cleaning"]'],
      software: ['["office"="it"]', '["office"="company"]'],
    },
  },

  AU: {
    countryCode: 'AU',
    countryName: 'Australia',
    dialCode: '+61',
    phonePattern: /(?:\+?61[-.\s]?|0)(?:[23478][-.\s]?\d{4}[-.\s]?\d{4})\b/,
    phoneExample: '+61 2 9374 4000',
    primaryTlds: ['.com.au', '.net.au', '.org.au', '.au', '.com'],
    administrativeDivisions: ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'],
    overpassAreaAdminLevel: '^[4-8]$',
    defaultQueryTemplates: [
      '"{niche}" "{city}" official website',
      '"{niche}" "{city}" contact us',
      '"{niche}" "{city}" book online',
      '"{niche}" "{city}" quote',
    ],
    nicheMappings: {
      dentist: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
      doctor: ['["amenity"="doctors"]'],
      restaurant: ['["amenity"="restaurant"]', '["amenity"="cafe"]'],
      cafe: ['["amenity"="cafe"]'],
      hvac: ['["craft"="hvac"]', '["craft"="electrician"]'],
      plumber: ['["craft"="plumber"]', '["trade"="plumber"]'],
      lawyer: ['["office"="lawyer"]', '["office"="legal"]'],
      roofing: ['["craft"="roofer"]'],
      autodealership: ['["shop"="car"]'],
      realestate: ['["office"="estate_agent"]'],
      gym: ['["leisure"="fitness_centre"]'],
      salon: ['["shop"="hairdresser"]', '["shop"="beauty"]'],
      cleaning: ['["craft"="cleaning"]'],
      software: ['["office"="it"]', '["office"="company"]'],
    },
  },

  PK: {
    countryCode: 'PK',
    countryName: 'Pakistan',
    dialCode: '+92',
    phonePattern: /(?:\+?92[-.\s]?|0)(?:3\d{2}[-.\s]?\d{7}|[456789]\d[-.\s]?\d{7})\b/,
    phoneExample: '+92 300 1234567',
    primaryTlds: ['.pk', '.com.pk', '.org.pk', '.com'],
    administrativeDivisions: ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad Capital Territory'],
    overpassAreaAdminLevel: '^[4-8]$',
    defaultQueryTemplates: [
      '"{niche}" "{city}" official website',
      '"{niche}" "{city}" contact details',
      '"{niche}" "{city}" services',
      '"{niche}" in "{city}" Pakistan',
    ],
    nicheMappings: {
      dentist: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
      doctor: ['["amenity"="doctors"]', '["amenity"="clinic"]', '["amenity"="hospital"]'],
      restaurant: ['["amenity"="restaurant"]', '["amenity"="fast_food"]', '["amenity"="cafe"]'],
      cafe: ['["amenity"="cafe"]', '["amenity"="restaurant"]'],
      hvac: ['["craft"="electrician"]', '["craft"="hvac"]'],
      plumber: ['["craft"="plumber"]'],
      lawyer: ['["office"="lawyer"]', '["office"="legal"]'],
      roofing: ['["craft"="construction"]', '["craft"="roofer"]'],
      autodealership: ['["shop"="car"]', '["shop"="car_repair"]'],
      realestate: ['["office"="estate_agent"]', '["office"="real_estate"]'],
      gym: ['["leisure"="fitness_centre"]'],
      salon: ['["shop"="hairdresser"]', '["shop"="beauty"]'],
      cleaning: ['["craft"="cleaning"]'],
      software: ['["office"="it"]', '["office"="company"]', '["office"="telecommunication"]'],
    },
  },
};

/**
 * Global fallback market profile
 */
export const GLOBAL_FALLBACK_PROFILE: CountryMarketProfile = {
  countryCode: 'GLOBAL',
  countryName: 'Global',
  dialCode: '+1',
  phonePattern: /(?:\+\d{1,4}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}\b/,
  phoneExample: '+1 (555) 000-0000',
  primaryTlds: ['.com', '.org', '.net', '.io', '.co'],
  administrativeDivisions: [],
  overpassAreaAdminLevel: '^[4-8]$',
  defaultQueryTemplates: [
    '"{niche}" "{city}" official website',
    '"{niche}" "{city}" contact',
    '"{niche}" "{city}" book',
    '"{niche}" "{city}" quote',
  ],
  nicheMappings: COUNTRY_MARKET_PROFILES.US.nicheMappings,
};

/**
 * Normalizes input country name or code and retrieves matching CountryMarketProfile.
 */
export function getMarketProfile(countryOrCode?: string): CountryMarketProfile {
  if (!countryOrCode) return COUNTRY_MARKET_PROFILES.US;

  const clean = countryOrCode.trim().toUpperCase();

  // 1. Direct code lookup
  if (COUNTRY_MARKET_PROFILES[clean]) {
    return COUNTRY_MARKET_PROFILES[clean];
  }

  // 2. Common synonyms
  if (clean === 'USA' || clean === 'UNITED STATES' || clean === 'UNITED STATES OF AMERICA' || clean === 'AMERICA') {
    return COUNTRY_MARKET_PROFILES.US;
  }
  if (clean === 'CAN' || clean === 'CANADA') {
    return COUNTRY_MARKET_PROFILES.CA;
  }
  if (clean === 'UK' || clean === 'GBR' || clean === 'BRITAIN' || clean === 'UNITED KINGDOM' || clean === 'ENGLAND') {
    return COUNTRY_MARKET_PROFILES.GB;
  }
  if (clean === 'AUS' || clean === 'AUSTRALIA') {
    return COUNTRY_MARKET_PROFILES.AU;
  }
  if (clean === 'PAK' || clean === 'PAKISTAN') {
    return COUNTRY_MARKET_PROFILES.PK;
  }

  // Search by countryName
  const match = Object.values(COUNTRY_MARKET_PROFILES).find(
    (p) => p.countryName.toLowerCase() === countryOrCode.trim().toLowerCase()
  );

  return match || GLOBAL_FALLBACK_PROFILE;
}
