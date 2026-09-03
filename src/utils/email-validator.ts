/**
 * Strict Email Validator for Pilot Candidate Selection
 *
 * Rejects UUIDs, hex strings, database IDs, missing @, invalid TLD,
 * and other non-email values that may appear as contact values.
 */

export interface EmailValidationResult {
  valid: boolean;
  reason?: string;
}

// Hex-only string pattern (UUIDs, database IDs, hex tokens)
const HEX_ONLY = /^[0-9a-f]+$/i;

// UUID v4 pattern
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Known invalid placeholder values
const INVALID_PLACEHOLDERS = [
  'n/a', 'na', 'none', 'null', 'undefined', 'contact', 'info',
  'email', 'test', 'admin', 'unknown', '-', '--', '...', '',
];

/**
 * Validates that a string is a syntactically valid, real-looking email address.
 * This is NOT a deliverability check — it only validates structure.
 */
export function isStrictlyValidEmail(value: string | null | undefined): EmailValidationResult {
  if (!value || typeof value !== 'string') {
    return { valid: false, reason: 'EMPTY_OR_NULL' };
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return { valid: false, reason: 'EMPTY_OR_NULL' };
  }

  // Check for known invalid placeholders (exact match, case insensitive)
  if (INVALID_PLACEHOLDERS.includes(trimmed.toLowerCase())) {
    return { valid: false, reason: 'KNOWN_PLACEHOLDER' };
  }

  // Check for numeric-only values
  if (/^\d+$/.test(trimmed)) {
    return { valid: false, reason: 'NUMERIC_ONLY' };
  }

  // Must contain exactly one @
  const atParts = trimmed.split('@');
  if (atParts.length !== 2) {
    return {
      valid: false,
      reason: atParts.length === 1 ? 'MISSING_AT_SIGN' : 'MULTIPLE_AT_SIGNS',
    };
  }

  const [localPart, domainPart] = atParts;

  // Local part validation
  if (!localPart || localPart.length === 0) {
    return { valid: false, reason: 'EMPTY_LOCAL_PART' };
  }
  if (localPart.length > 64) {
    return { valid: false, reason: 'LOCAL_PART_TOO_LONG' };
  }

  // Domain part validation
  if (!domainPart || domainPart.length === 0) {
    return { valid: false, reason: 'EMPTY_DOMAIN' };
  }

  // Domain must contain at least one dot (tld separator)
  const domainLabels = domainPart.split('.');
  if (domainLabels.length < 2) {
    return { valid: false, reason: 'MISSING_TLD' };
  }

  // TLD must be at least 2 alphabetic characters
  const tld = domainLabels[domainLabels.length - 1]!;
  if (tld.length < 2 || !/^[a-zA-Z]{2,}$/.test(tld)) {
    return { valid: false, reason: 'INVALID_TLD' };
  }

  // Each domain label must be valid (alphanumeric + hyphen, not start/end with hyphen)
  for (const label of domainLabels) {
    if (!label || label.length === 0) {
      return { valid: false, reason: 'EMPTY_DOMAIN_LABEL' };
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      return { valid: false, reason: 'INVALID_DOMAIN_LABEL' };
    }
    if (!/^[a-zA-Z0-9-]+$/.test(label)) {
      return { valid: false, reason: 'INVALID_DOMAIN_CHARACTERS' };
    }
  }

  // Reject if the whole value (without @) looks like a UUID or hex token
  const withoutAt = localPart + domainPart.replace(/\./g, '');
  if (UUID_PATTERN.test(trimmed)) {
    return { valid: false, reason: 'UUID_VALUE' };
  }
  if (HEX_ONLY.test(withoutAt) && withoutAt.length >= 16) {
    return { valid: false, reason: 'HEX_TOKEN_VALUE' };
  }

  // Reject if localPart alone looks like a raw hex/uuid token (no real name)
  if (HEX_ONLY.test(localPart) && localPart.length >= 16) {
    return { valid: false, reason: 'HEX_LOCAL_PART' };
  }

  // Reject telemetry / analytics / sentry / crash-reporting tokens
  if (/sentry|wixpress\.com|telemetry|analytics|crashlytics|bugsnag/i.test(domainPart) || /sentry/i.test(localPart)) {
    return { valid: false, reason: 'TELEMETRY_TOKEN_EMAIL' };
  }

  // Basic RFC-ish local part character check
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart)) {
    return { valid: false, reason: 'INVALID_LOCAL_PART_CHARACTERS' };
  }

  return { valid: true };
}

/**
 * Normalizes country strings to a canonical two-letter code for comparison.
 * Returns 'US' for any US variant, 'CA' for Canada, etc.
 */
export function normalizeCountryCode(country: string | null | undefined): string {
  if (!country) return '';
  const c = country.trim().toUpperCase();

  // US variants
  if (['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA', 'U.S.', 'U.S.A.'].includes(c)) {
    return 'US';
  }
  // CA variants
  if (['CA', 'CAN', 'CANADA'].includes(c)) {
    return 'CA';
  }
  // GB variants
  if (['GB', 'GBR', 'UK', 'UNITED KINGDOM', 'GREAT BRITAIN'].includes(c)) {
    return 'GB';
  }
  // AU variants
  if (['AU', 'AUS', 'AUSTRALIA'].includes(c)) {
    return 'AU';
  }
  // PK variants
  if (['PK', 'PAK', 'PAKISTAN'].includes(c)) {
    return 'PK';
  }

  return c;
}
