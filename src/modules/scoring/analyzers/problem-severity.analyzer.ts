import { OpportunityFlag } from '../../../types/index.js';

export interface ProblemSeverityInput {
  hasNoWebsite: boolean;
  opportunityFlags: OpportunityFlag[];
  findingsTitles: string[];
}

export interface ProblemSeverityResult {
  score: number;
  criticalProblems: string[];
  highProblems: string[];
  mediumProblems: string[];
  lowProblems: string[];
}

export function analyzeProblemSeverity(input: ProblemSeverityInput): ProblemSeverityResult {
  const critical: string[] = [];
  const high: string[] = [];
  const medium: string[] = [];
  const low: string[] = [];
  let score = 0;

  if (input.hasNoWebsite || input.opportunityFlags.includes('NO_WEBSITE')) {
    score += 85;
    critical.push('No website registered (Critical web development opportunity)');
  }

  if (input.opportunityFlags.includes('POOR_MOBILE') || input.opportunityFlags.includes('BROKEN_ELEMENTS')) {
    score += 30;
    critical.push('Broken mobile layout or layout overflow');
  }

  if (input.opportunityFlags.includes('SLOW_LOADING')) {
    score += 20;
    high.push('Severe page load latency hurting customer conversions');
  }

  if (input.opportunityFlags.includes('NO_CLEAR_CTA') || input.opportunityFlags.includes('NO_CONTACT_METHOD')) {
    score += 20;
    high.push('Missing direct conversion call-to-action or phone link');
  }

  if (input.opportunityFlags.includes('WEAK_SEO')) {
    score += 15;
    medium.push('Search engine indexing or meta description weaknesses');
  }

  if (input.opportunityFlags.includes('THIN_CONTENT') || input.opportunityFlags.includes('OUTDATED_SIGNALS')) {
    score += 15;
    medium.push('Thin homepage content or template demo text detected');
  }

  if (input.opportunityFlags.includes('ACCESSIBILITY_ISSUES')) {
    score += 10;
    low.push('Accessibility gaps (unlabeled form inputs, missing alt text)');
  }

  return {
    score: Math.min(100, Math.max(0, score)),
    criticalProblems: critical,
    highProblems: high,
    mediumProblems: medium,
    lowProblems: low,
  };
}
