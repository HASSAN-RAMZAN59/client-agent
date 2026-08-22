import { OutreachQualityCheck } from '../../types/index.js';

const BANNED_PATTERNS = [
  /\burgent\b/i,
  /\bfinal warning\b/i,
  /\blosing (?:customers|revenue|money|clients|sales)\b/i,
  /\b100%\s*guaranteed\b/i,
  /\bguaranteed\s+(?:growth|results|revenue|leads)\b/i,
  /\bsecret\s+(?:formula|trick|hack)\b/i,
  /\bact\s+now\b/i,
  /\bbest\s+price\s+guaranteed\b/i,
  /\byour\s+business\s+is\s+failing\b/i,
  /\byour\s+competitors\s+are\s+destroying\b/i,
  /\byour\s+traffic\s+(?:dropped|crashed)\b/i,
];

const PROMOTIONAL_CLICKBAIT = [
  /\bclick\s+here\b/i,
  /\bfree\s+money\b/i,
  /\bdouble\s+your\s+revenue\b/i,
  /\btriple\s+your\s+revenue\b/i,
  /\brank\s+#?1\s+on\s+google\b/i,
];

export class OutreachQualityGuard {
  public static evaluate(subject: string, body: string): OutreachQualityCheck {
    const combined = `${subject}\n${body}`;
    const warnings: string[] = [];
    const blockedReasons: string[] = [];
    let score = 100;

    // 1. Check Banned Hard Spam / Fear-based Phrases
    for (const pattern of BANNED_PATTERNS) {
      if (pattern.test(combined)) {
        blockedReasons.push(`Contains banned manipulative/fear-based language: "${pattern.source}"`);
        score -= 40;
      }
    }

    // 2. Check Overly Promotional Clickbait
    for (const pattern of PROMOTIONAL_CLICKBAIT) {
      if (pattern.test(combined)) {
        warnings.push(`Contains promotional clickbait pattern: "${pattern.source}"`);
        score -= 25;
      }
    }

    // 3. Check Exclamation Marks (Max 1 per email)
    const exclamationCount = (combined.match(/!/g) || []).length;
    if (exclamationCount > 1) {
      warnings.push(`Excessive exclamation marks (${exclamationCount} found). Cold outreach should be natural and professional.`);
      score -= 15;
    }

    // 4. Check Excessive Capitalization
    const uppercaseWords = combined.match(/\b[A-Z]{3,}\b/g) || [];
    const filteredCaps = uppercaseWords.filter(
      (w) => !['SSL', 'SEO', 'CTA', 'URL', 'UX', 'UI', 'HTML', 'CSS', 'USA', 'TX', 'NYC', 'LA'].includes(w)
    );
    if (filteredCaps.length > 2) {
      warnings.push(`Excessive uppercase words detected: [${filteredCaps.join(', ')}]`);
      score -= 20;
    }

    // 5. Check Fabricated Claims / Unsupported Statistics
    if (/\b(?:lost|losing)\s+\$\d+/i.test(combined) || /\b\d+%\s+of\s+your\s+visitors\b/i.test(combined)) {
      blockedReasons.push('Contains unsupported financial or statistical claims not present in audit evidence.');
      score -= 50;
    }

    const passed = blockedReasons.length === 0 && score >= 70;

    return {
      passed,
      score: Math.max(0, score),
      warnings,
      blockedReasons,
    };
  }
}
