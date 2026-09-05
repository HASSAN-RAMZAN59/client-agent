/**
 * Canonical Niche Normalization Registry & Engine
 * Normalizes diverse user inputs, abbreviations, and composite labels
 * (e.g. "dental /dentist", "Dental Clinic", "Dentist", "Dental") into a single authoritative
 * canonical representation, clean UI display label, and natural discovery aliases.
 */

export type CanonicalNiche =
  | 'DENTIST'
  | 'HVAC'
  | 'CAFE'
  | 'RESTAURANT'
  | 'HARDWARE_STORE'
  | 'DOCTOR'
  | 'PLUMBER'
  | 'LAWYER'
  | 'ROOFING'
  | 'AUTO_DEALERSHIP'
  | 'REAL_ESTATE'
  | 'GYM'
  | 'SALON'
  | 'CLEANING'
  | 'SOFTWARE'
  | 'UNKNOWN';

export interface NicheDefinition {
  canonical: string;
  label: string;
  primaryQueryTerm: string;
  aliases: string[];
  osmTags: string[];
  isCanonical: boolean;
  isValid: boolean;
  rawInput?: string;
}

interface NicheEntry {
  canonical: CanonicalNiche;
  label: string;
  primaryQueryTerm: string;
  aliases: string[];
  osmTags: string[];
  matchPatterns: string[];
}

const CANONICAL_NICHE_REGISTRY: Record<CanonicalNiche, NicheEntry> = {
  DENTIST: {
    canonical: 'DENTIST',
    label: 'Dentist',
    primaryQueryTerm: 'dentist',
    aliases: ['dentist', 'dental clinic', 'dental surgery', 'dentistry'],
    osmTags: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
    matchPatterns: [
      'dentist',
      'dental',
      'dentistry',
      'dental clinic',
      'dental clinics',
      'dental surgery',
      'dental care',
      'dental practice',
      'dental office',
      'orthodontist',
      'orthodontics',
      'oral surgeon',
      'oral surgery',
      'teeth',
      'endodontist',
      'periodontist',
    ],
  },
  HVAC: {
    canonical: 'HVAC',
    label: 'HVAC',
    primaryQueryTerm: 'hvac',
    aliases: ['hvac', 'air conditioning', 'heating and cooling', 'ac repair'],
    osmTags: ['["craft"="hvac"]', '["craft"="electrician"]', '["craft"="plumber"]'],
    matchPatterns: [
      'hvac',
      'air conditioning',
      'air condition',
      'heating',
      'cooling',
      'ac repair',
      'furnace',
      'ventilation',
      'heating & air conditioning',
      'heating and air conditioning',
      'climate control',
    ],
  },
  CAFE: {
    canonical: 'CAFE',
    label: 'Cafe',
    primaryQueryTerm: 'cafe',
    aliases: ['cafe', 'coffee shop', 'bakery cafe', 'espresso bar'],
    osmTags: ['["amenity"="cafe"]', '["shop"="bakery"]'],
    matchPatterns: [
      'cafe',
      'café',
      'coffee',
      'coffee shop',
      'bakery',
      'espresso',
      'tea house',
      'bistro cafe',
    ],
  },
  RESTAURANT: {
    canonical: 'RESTAURANT',
    label: 'Restaurant',
    primaryQueryTerm: 'restaurant',
    aliases: ['restaurant', 'dining', 'bistro', 'eatery'],
    osmTags: ['["amenity"="restaurant"]', '["amenity"="fast_food"]'],
    matchPatterns: [
      'restaurant',
      'dining',
      'bistro',
      'eatery',
      'diner',
      'food',
      'grill',
      'steakhouse',
      'pizzeria',
      'fine dining',
    ],
  },
  HARDWARE_STORE: {
    canonical: 'HARDWARE_STORE',
    label: 'Hardware Store',
    primaryQueryTerm: 'hardware store',
    aliases: ['hardware store', 'tools and hardware', 'building supplies', 'home improvement'],
    osmTags: ['["shop"="hardware"]', '["shop"="doityourself"]', '["shop"="trade"]'],
    matchPatterns: [
      'hardware store',
      'hardware',
      'hardware_store',
      'tools',
      'building supplies',
      'home improvement',
      'diy store',
      'timber and hardware',
    ],
  },
  DOCTOR: {
    canonical: 'DOCTOR',
    label: 'Doctor',
    primaryQueryTerm: 'doctor',
    aliases: ['doctor', 'medical clinic', 'physician', 'family practice'],
    osmTags: ['["amenity"="doctors"]', '["amenity"="clinic"]', '["healthcare"="doctor"]'],
    matchPatterns: [
      'doctor',
      'physician',
      'medical clinic',
      'medical center',
      'general practitioner',
      'family medicine',
      'pediatrician',
      'clinic',
    ],
  },
  PLUMBER: {
    canonical: 'PLUMBER',
    label: 'Plumber',
    primaryQueryTerm: 'plumber',
    aliases: ['plumber', 'plumbing services', 'emergency plumbing', 'drain cleaning'],
    osmTags: ['["craft"="plumber"]', '["trade"="plumber"]'],
    matchPatterns: ['plumber', 'plumbing', 'drain cleaning', 'pipe repair'],
  },
  LAWYER: {
    canonical: 'LAWYER',
    label: 'Lawyer',
    primaryQueryTerm: 'lawyer',
    aliases: ['lawyer', 'attorney', 'law firm', 'legal services'],
    osmTags: ['["office"="lawyer"]', '["office"="legal"]'],
    matchPatterns: [
      'lawyer',
      'attorney',
      'law firm',
      'legal services',
      'legal',
      'solicitor',
      'barrister',
    ],
  },
  ROOFING: {
    canonical: 'ROOFING',
    label: 'Roofing',
    primaryQueryTerm: 'roofing',
    aliases: ['roofing', 'roofing contractor', 'roof repair', 'roof replacement'],
    osmTags: ['["craft"="roofer"]', '["craft"="construction"]'],
    matchPatterns: ['roofing', 'roofer', 'roof repair', 'roof replacement', 'gutters'],
  },
  AUTO_DEALERSHIP: {
    canonical: 'AUTO_DEALERSHIP',
    label: 'Auto Dealership',
    primaryQueryTerm: 'car dealership',
    aliases: ['car dealership', 'auto dealer', 'used cars', 'auto sales'],
    osmTags: ['["shop"="car"]', '["shop"="car_repair"]'],
    matchPatterns: [
      'car dealer',
      'auto dealer',
      'dealership',
      'car sales',
      'auto dealership',
      'used cars',
      'used car dealer',
      'autodealership',
    ],
  },
  REAL_ESTATE: {
    canonical: 'REAL_ESTATE',
    label: 'Real Estate',
    primaryQueryTerm: 'real estate agency',
    aliases: ['real estate agency', 'realtor', 'property management', 'real estate broker'],
    osmTags: ['["office"="estate_agent"]', '["office"="real_estate"]'],
    matchPatterns: [
      'real estate',
      'realtor',
      'property management',
      'real estate agency',
      'estate agent',
      'realestate',
    ],
  },
  GYM: {
    canonical: 'GYM',
    label: 'Gym',
    primaryQueryTerm: 'gym',
    aliases: ['gym', 'fitness center', 'fitness club', 'crossfit'],
    osmTags: ['["leisure"="fitness_centre"]', '["leisure"="sports_centre"]'],
    matchPatterns: ['gym', 'fitness', 'fitness center', 'crossfit', 'workout', 'health club'],
  },
  SALON: {
    canonical: 'SALON',
    label: 'Salon',
    primaryQueryTerm: 'hair salon',
    aliases: ['hair salon', 'beauty salon', 'barbershop', 'spa'],
    osmTags: ['["shop"="hairdresser"]', '["shop"="beauty"]'],
    matchPatterns: [
      'hair salon',
      'beauty salon',
      'salon',
      'barber',
      'barbershop',
      'hairdresser',
      'spa',
    ],
  },
  CLEANING: {
    canonical: 'CLEANING',
    label: 'Cleaning',
    primaryQueryTerm: 'cleaning service',
    aliases: ['cleaning service', 'commercial cleaning', 'janitorial services', 'house cleaning'],
    osmTags: ['["craft"="cleaning"]', '["office"="cleaning"]'],
    matchPatterns: [
      'cleaning',
      'commercial cleaning',
      'janitorial',
      'maid service',
      'house cleaning',
    ],
  },
  SOFTWARE: {
    canonical: 'SOFTWARE',
    label: 'Software',
    primaryQueryTerm: 'software company',
    aliases: ['software company', 'it services', 'tech agency', 'web development'],
    osmTags: ['["office"="it"]', '["office"="company"]', '["office"="telecommunication"]'],
    matchPatterns: [
      'software',
      'it services',
      'tech',
      'web development',
      'software agency',
      'app development',
      'software company',
    ],
  },
  UNKNOWN: {
    canonical: 'UNKNOWN',
    label: 'Unknown',
    primaryQueryTerm: '',
    aliases: [],
    osmTags: [],
    matchPatterns: [],
  },
};

/**
 * Converts a string to Title Case safely.
 */
function toTitleCase(str: string): string {
  return str
    .split(/\s+/)
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1).toLowerCase() : ''))
    .join(' ');
}

/**
 * Normalizes arbitrary user niche input into an authoritative NicheDefinition.
 * Handles combined inputs (e.g. "dental /dentist"), abbreviations, casing,
 * and falls back safely to sanitized generic definitions for unknown commercial niches.
 */
export function normalizeNiche(rawInput?: string | null): NicheDefinition {
  if (!rawInput || typeof rawInput !== 'string') {
    return {
      canonical: 'UNKNOWN',
      label: '',
      primaryQueryTerm: '',
      aliases: [],
      osmTags: [],
      isCanonical: false,
      isValid: false,
      rawInput: rawInput ?? undefined,
    };
  }

  const raw = rawInput.trim();
  // Strip surrounding quotes and whitespace
  let clean = raw.replace(/^["'`]+|["'`]+$/g, '').trim();

  // Strip leading/trailing slashes, hyphens, colons, or pipes
  clean = clean.replace(/^[\s/\\|:;,\-]+|[\s/\\|:;,\-]+$/g, '').trim();

  if (!clean || !/[a-zA-Z0-9]/.test(clean)) {
    return {
      canonical: 'UNKNOWN',
      label: '',
      primaryQueryTerm: '',
      aliases: [],
      osmTags: [],
      isCanonical: false,
      isValid: false,
      rawInput: raw,
    };
  }

  const lower = clean.toLowerCase();

  // 1. Direct match on Canonical Enum key (e.g. "DENTIST", "HVAC")
  const upperKey = clean.toUpperCase().replace(/\s+/g, '_') as CanonicalNiche;
  if (CANONICAL_NICHE_REGISTRY[upperKey] && upperKey !== 'UNKNOWN') {
    const entry = CANONICAL_NICHE_REGISTRY[upperKey];
    return {
      canonical: entry.canonical,
      label: entry.label,
      primaryQueryTerm: entry.primaryQueryTerm,
      aliases: [...entry.aliases],
      osmTags: [...entry.osmTags],
      isCanonical: true,
      isValid: true,
      rawInput: raw,
    };
  }

  // 2. Direct match across registry matchPatterns
  for (const entry of Object.values(CANONICAL_NICHE_REGISTRY)) {
    if (entry.canonical === 'UNKNOWN') continue;
    if (
      entry.label.toLowerCase() === lower ||
      entry.primaryQueryTerm.toLowerCase() === lower ||
      entry.matchPatterns.some((pattern) => pattern.toLowerCase() === lower)
    ) {
      return {
        canonical: entry.canonical,
        label: entry.label,
        primaryQueryTerm: entry.primaryQueryTerm,
        aliases: [...entry.aliases],
        osmTags: [...entry.osmTags],
        isCanonical: true,
        isValid: true,
        rawInput: raw,
      };
    }
  }

  // 3. Multi-token / delimiter parsing (e.g. "dental /dentist", "Dental / Dentist", "HVAC / Air Conditioning")
  const tokens = clean
    .split(/[\/|,&+]/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && /[a-zA-Z0-9]/.test(t));

  if (tokens.length > 0) {
    for (const token of tokens) {
      for (const entry of Object.values(CANONICAL_NICHE_REGISTRY)) {
        if (entry.canonical === 'UNKNOWN') continue;
        if (
          entry.label.toLowerCase() === token ||
          entry.primaryQueryTerm.toLowerCase() === token ||
          entry.matchPatterns.some((pattern) => pattern.toLowerCase() === token)
        ) {
          return {
            canonical: entry.canonical,
            label: entry.label,
            primaryQueryTerm: entry.primaryQueryTerm,
            aliases: [...entry.aliases],
            osmTags: [...entry.osmTags],
            isCanonical: true,
            isValid: true,
            rawInput: raw,
          };
        }
      }
    }
  }

  // 4. Substring / Word Boundary heuristic matching for known niches
  if (/\b(?:dentist|dental|dentistry|teeth|orthodont)\b/i.test(clean)) {
    const entry = CANONICAL_NICHE_REGISTRY.DENTIST;
    return {
      canonical: entry.canonical,
      label: entry.label,
      primaryQueryTerm: entry.primaryQueryTerm,
      aliases: [...entry.aliases],
      osmTags: [...entry.osmTags],
      isCanonical: true,
      isValid: true,
      rawInput: raw,
    };
  }

  if (/\b(?:hvac|air\s*condition(?:ing)?|heating|furnace|cooling|ac\s*repair|\bac\b)\b/i.test(clean)) {
    const entry = CANONICAL_NICHE_REGISTRY.HVAC;
    return {
      canonical: entry.canonical,
      label: entry.label,
      primaryQueryTerm: entry.primaryQueryTerm,
      aliases: [...entry.aliases],
      osmTags: [...entry.osmTags],
      isCanonical: true,
      isValid: true,
      rawInput: raw,
    };
  }

  if (/\b(?:hardware(?:\s*store)?|tools|diy\s*store)\b/i.test(clean)) {
    const entry = CANONICAL_NICHE_REGISTRY.HARDWARE_STORE;
    return {
      canonical: entry.canonical,
      label: entry.label,
      primaryQueryTerm: entry.primaryQueryTerm,
      aliases: [...entry.aliases],
      osmTags: [...entry.osmTags],
      isCanonical: true,
      isValid: true,
      rawInput: raw,
    };
  }

  if (/\b(?:cafe|café|coffee(?:\s*shop)?|espresso|bakery)\b/i.test(clean)) {
    const entry = CANONICAL_NICHE_REGISTRY.CAFE;
    return {
      canonical: entry.canonical,
      label: entry.label,
      primaryQueryTerm: entry.primaryQueryTerm,
      aliases: [...entry.aliases],
      osmTags: [...entry.osmTags],
      isCanonical: true,
      isValid: true,
      rawInput: raw,
    };
  }

  if (/\b(?:restaurant|bistro|diner|eatery|grill|steakhouse)\b/i.test(clean)) {
    const entry = CANONICAL_NICHE_REGISTRY.RESTAURANT;
    return {
      canonical: entry.canonical,
      label: entry.label,
      primaryQueryTerm: entry.primaryQueryTerm,
      aliases: [...entry.aliases],
      osmTags: [...entry.osmTags],
      isCanonical: true,
      isValid: true,
      rawInput: raw,
    };
  }

  // 5. Safe Generic Handling for Unknown / Custom Niches
  // Strip slashes and special characters so malformed queries never reach search engines or OSM
  const cleanTokens = tokens
    .map((t) => t.replace(/[^\w\s-]/g, '').trim())
    .filter((t) => t.length > 0);

  const primaryCleanTerm = cleanTokens[0] || clean.replace(/[^\w\s-]/g, '').trim();
  const sanitizedLabel = toTitleCase(primaryCleanTerm);
  const canonicalKey = primaryCleanTerm.toUpperCase().replace(/[\s-]+/g, '_');
  const safeTag = primaryCleanTerm.toLowerCase().replace(/[^a-z0-9]/g, '_');

  const safeAliases = Array.from(new Set([primaryCleanTerm.toLowerCase(), ...cleanTokens]));

  return {
    canonical: canonicalKey,
    label: sanitizedLabel,
    primaryQueryTerm: primaryCleanTerm.toLowerCase(),
    aliases: safeAliases,
    osmTags: [
      `["shop"="${safeTag}"]`,
      `["amenity"="${safeTag}"]`,
      `["craft"="${safeTag}"]`,
      `["office"="${safeTag}"]`,
    ],
    isCanonical: false,
    isValid: true,
    rawInput: raw,
  };
}

/**
 * Returns all registered canonical niche definitions.
 */
export function getAllCanonicalNiches(): NicheDefinition[] {
  return Object.values(CANONICAL_NICHE_REGISTRY)
    .filter((e) => e.canonical !== 'UNKNOWN')
    .map((e) => ({
      canonical: e.canonical,
      label: e.label,
      primaryQueryTerm: e.primaryQueryTerm,
      aliases: [...e.aliases],
      osmTags: [...e.osmTags],
      isCanonical: true,
      isValid: true,
    }));
}
