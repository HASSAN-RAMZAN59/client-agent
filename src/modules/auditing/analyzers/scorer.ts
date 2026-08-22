import {
  AuditCategoryScores,
  AuditFinding,
  OpportunityFlag,
} from '../../../types/index.js';

export interface ScoreCompositionInput {
  technicalScore: number;
  mobileScore: number;
  performanceScore: number;
  seoScore: number;
  accessibilityScore: number;
  uxScore: number;
  contentScore: number;
  findings: AuditFinding[];
}

export interface ScoreCompositionResult {
  overallScore: number;
  categories: AuditCategoryScores;
  opportunityFlags: OpportunityFlag[];
  topProblems: string[];
}

export function computeAuditScoresAndFlags(input: ScoreCompositionInput): ScoreCompositionResult {
  const categories: AuditCategoryScores = {
    technical: Math.round(Math.max(0, Math.min(100, input.technicalScore))),
    mobile: Math.round(Math.max(0, Math.min(100, input.mobileScore))),
    performance: Math.round(Math.max(0, Math.min(100, input.performanceScore))),
    seo: Math.round(Math.max(0, Math.min(100, input.seoScore))),
    accessibility: Math.round(Math.max(0, Math.min(100, input.accessibilityScore))),
    ux: Math.round(Math.max(0, Math.min(100, input.uxScore))),
    content: Math.round(Math.max(0, Math.min(100, input.contentScore))),
  };

  // Weighted composite score (0-100)
  // Technical: 20%, Mobile: 20%, Performance: 15%, SEO: 10%, Accessibility: 10%, UX: 15%, Content: 10%
  const weightedOverall =
    categories.technical * 0.20 +
    categories.mobile * 0.20 +
    categories.performance * 0.15 +
    categories.seo * 0.10 +
    categories.accessibility * 0.10 +
    categories.ux * 0.15 +
    categories.content * 0.10;

  const overallScore = Math.round(Math.max(0, Math.min(100, weightedOverall)));

  // Derive actionable opportunity flags
  const flags: OpportunityFlag[] = [];

  if (categories.mobile < 65) flags.push('POOR_MOBILE');
  if (categories.performance < 60) flags.push('SLOW_LOADING');
  if (categories.ux < 60) flags.push('NO_CLEAR_CTA');
  if (categories.ux < 40) flags.push('NO_CONTACT_METHOD');
  if (categories.seo < 60) flags.push('WEAK_SEO');
  if (categories.accessibility < 60) flags.push('ACCESSIBILITY_ISSUES');
  if (categories.content < 60) flags.push('THIN_CONTENT');

  input.findings.forEach((f) => {
    if (f.title.toLowerCase().includes('booking') && !flags.includes('NO_BOOKING')) {
      flags.push('NO_BOOKING');
    }
    if (f.title.toLowerCase().includes('placeholder') && !flags.includes('OUTDATED_SIGNALS')) {
      flags.push('OUTDATED_SIGNALS');
    }
  });

  // Extract top problems sorted by severity (HIGH -> MEDIUM -> LOW)
  const severityRank: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
  const sortedFindings = [...input.findings].sort(
    (a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0)
  );

  const topProblems = sortedFindings.slice(0, 4).map((f) => f.title);

  return {
    overallScore,
    categories,
    opportunityFlags: flags,
    topProblems,
  };
}
