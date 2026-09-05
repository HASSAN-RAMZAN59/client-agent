export interface ExtractedPhone {
  rawPhone: string;
  normalizedPhone: string;
  country: string;
  rawSource: 'tel' | 'text';
}

export function normalizePhoneNumber(raw: string): { normalized: string; country: string } | null {
  if (!raw) return null;

  // Remove non-digit characters except leading +
  const hasPlus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');

  // Standard US / North American Numbering Plan (10 digits, or 11 with leading 1)
  // Note: NANP area codes can never start with 0 or 1
  if (!hasPlus && digits.length === 10 && digits[0] >= '2' && digits[0] <= '9') {
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

  // Pakistan (+92)
  if (digits.startsWith('92') && (digits.length === 12 || digits.length === 11)) {
    return {
      normalized: `+${digits}`,
      country: 'PK',
    };
  }

  // Pakistan Domestic (03XX XXXXXXX -> +923XXXXXXXXX, or domestic landline 04X XXXXXXX -> +924XXXXXXXX)
  if (digits.startsWith('03') && digits.length === 11) {
    return {
      normalized: `+92${digits.slice(1)}`,
      country: 'PK',
    };
  }
  if (digits.startsWith('0') && (digits.length === 10 || digits.length === 11) && !hasPlus) {
    if (
      digits.startsWith('02') ||
      digits.startsWith('04') ||
      digits.startsWith('05') ||
      digits.startsWith('06') ||
      digits.startsWith('07') ||
      digits.startsWith('08') ||
      digits.startsWith('09')
    ) {
      return {
        normalized: `+92${digits.slice(1)}`,
        country: 'PK',
      };
    }
  }

  // UK (+44)
  if (digits.startsWith('44') && digits.length >= 10 && digits.length <= 13) {
    return {
      normalized: `+${digits}`,
      country: 'GB',
    };
  }

  // Australia (+61)
  if (digits.startsWith('61') && digits.length >= 9 && digits.length <= 12) {
    return {
      normalized: `+${digits}`,
      country: 'AU',
    };
  }

  // International format fallback (minimum 7 digits, max 15)
  if (digits.length >= 7 && digits.length <= 15) {
    return {
      normalized: `+${digits}`,
      country: 'INTERNATIONAL',
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

  // 2. Extract standard US & International phone numbers from text
  // Pattern matches (123) 456-7890, +44 20 7946 0958, +92 42 35789000, +61 2 9374 4000
  const phoneTextRegex = /(?:\+(?:[1-9]\d{0,2})[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}\b/g;
  while ((match = phoneTextRegex.exec(html)) !== null) {
    const raw = match[0]?.trim();
    if (raw && raw.length >= 7) {
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
