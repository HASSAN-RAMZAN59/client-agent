export interface ExtractedPhone {
  rawPhone: string;
  normalizedPhone: string;
  country: string;
  rawSource: 'tel' | 'text';
}

export function normalizePhoneNumber(raw: string): { normalized: string; country: string } | null {
  if (!raw) return null;

  // Remove non-digit characters except leading +
  const digits = raw.replace(/\D/g, '');

  // Standard US / North American Numbering Plan (10 digits, or 11 with leading 1)
  if (digits.length === 10) {
    const area = digits.slice(0, 3);
    const prefix = digits.slice(3, 6);
    const line = digits.slice(6, 10);
    return {
      normalized: `+1 (${area}) ${prefix}-${line}`,
      country: 'US',
    };
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    const area = digits.slice(1, 4);
    const prefix = digits.slice(4, 7);
    const line = digits.slice(7, 11);
    return {
      normalized: `+1 (${area}) ${prefix}-${line}`,
      country: 'US',
    };
  }

  // International format fallback (minimum 7 digits, max 15)
  if (digits.length >= 7 && digits.length <= 15) {
    return {
      normalized: `+${digits}`,
      country: 'UNKNOWN',
    };
  }

  return null;
}

export function extractPhonesFromHtml(html: string): ExtractedPhone[] {
  const results: Map<string, ExtractedPhone> = new Map();

  // 1. Extract from tel: links (highest reliability)
  const telRegex = /href=["']tel:\s*([^"']+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = telRegex.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (raw) {
      const normalizedRes = normalizePhoneNumber(raw);
      if (normalizedRes && !results.has(normalizedRes.normalized)) {
        results.set(normalizedRes.normalized, {
          rawPhone: raw,
          normalizedPhone: normalizedRes.normalized,
          country: normalizedRes.country,
          rawSource: 'tel',
        });
      }
    }
  }

  // 2. Extract standard US phone numbers from text
  // Pattern matches (123) 456-7890, 123-456-7890, 123.456.7890, +1 123 456 7890
  const phoneTextRegex = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]\d{4}\b/g;
  while ((match = phoneTextRegex.exec(html)) !== null) {
    const raw = match[0]?.trim();
    if (raw) {
      const normalizedRes = normalizePhoneNumber(raw);
      if (normalizedRes && !results.has(normalizedRes.normalized)) {
        results.set(normalizedRes.normalized, {
          rawPhone: raw,
          normalizedPhone: normalizedRes.normalized,
          country: normalizedRes.country,
          rawSource: 'text',
        });
      }
    }
  }

  return Array.from(results.values());
}
