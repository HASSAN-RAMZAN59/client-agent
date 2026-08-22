import { PersonalizationContext } from '../../../types/index.js';

const UNSUPPORTED_CLAIM_PATTERNS = [
  { pattern: /\blosing (?:customers|clients|patients|leads)\b/i, reason: 'Unsupported claim of customer loss.' },
  { pattern: /\b(?:losing|costing|lost)\s+(?:thousands|millions|\$?\d+|revenue|sales|money)\b/i, reason: 'Unsupported claim of financial or revenue loss.' },
  { pattern: /(?:^|\s|\$)\d+(?:,\d+)*(?:\s*(?:in\s+revenue|per\s+month|lost|loss|\/mo))\b/i, reason: 'Unsupported claim of financial or revenue loss.' },
  { pattern: /(?:^|\s)\$\d+(?:,\d+)*\b/i, reason: 'Unsupported claim of financial or revenue loss.' },
  { pattern: /\b(?:traffic\s+has\s+dropped|traffic\s+crashed|traffic\s+plunge)\b/i, reason: 'Unsupported claim regarding website traffic analytics.' },
  { pattern: /\bconversion\s+rate\s+is\s+low\b/i, reason: 'Unsupported claim regarding private conversion rates.' },
  { pattern: /\byour\s+competitors\s+are\s+(?:getting\s+more|destroying|beating)\b/i, reason: 'Unsupported competitor comparison claim.' },
  { pattern: /\b(?:double|triple)\s+your\s+revenue\b/i, reason: 'Unsupported revenue multiplication guarantee.' },
  { pattern: /\brank\s+#?1\s+on\s+google\b/i, reason: 'Unsupported SEO ranking claim.' },
  { pattern: /\byour\s+\d+\s+employees\b/i, reason: 'Fabricated employee count claim.' },
];

export interface EvidenceValidationResult {
  valid: boolean;
  reasons: string[];
  warnings: string[];
}

export class EvidenceValidator {
  public static validate(subject: string, body: string, context: PersonalizationContext): EvidenceValidationResult {
    const text = `${subject}\n${body}`;
    const reasons: string[] = [];
    const warnings: string[] = [];

    // 1. Scan for unsupported / fabricated factual claims
    for (const { pattern, reason } of UNSUPPORTED_CLAIM_PATTERNS) {
      if (pattern.test(text)) {
        reasons.push(reason);
      }
    }

    // 2. Validate Performance Time Claims
    const loadTimeMatch = text.match(/(\d+(?:\.\d+)?)\s*s(?:ec)?\b/i);
    if (loadTimeMatch) {
      const claimedSeconds = parseFloat(loadTimeMatch[1]);
      const actualSeconds = context.audit?.loadTimeMs ? context.audit.loadTimeMs / 1000 : null;

      if (!actualSeconds) {
        reasons.push(`Draft mentions specific load time (${claimedSeconds}s) but no load time is recorded in audit.`);
      } else if (Math.abs(claimedSeconds - actualSeconds) > 1.5) {
        warnings.push(`Claimed load time (${claimedSeconds}s) differs significantly from audited time (${actualSeconds.toFixed(1)}s).`);
      }
    }

    // 3. Validate No-Website Consistency
    const mentionsNoWebsite = /doesn't\s+currently\s+have\s+(?:an?\s+official|a\s+dedicated)\s+website/i.test(text);
    if (mentionsNoWebsite && context.business.website && context.audit?.websiteStatus === 'AUDITED') {
      reasons.push('Draft claims business has no website, but an active audited website exists in records.');
    }

    return {
      valid: reasons.length === 0,
      reasons,
      warnings,
    };
  }
}
