import { AuditFinding } from '../../../types/index.js';

export interface AccessibilityAnalysisInput {
  totalImages: number;
  imagesWithAlt: number;
  unlabeledButtonsCount: number;
  emptyLinksCount: number;
  unlabeledInputsCount: number;
}

export interface AccessibilityAnalysisResult {
  score: number;
  findings: AuditFinding[];
}

export function analyzeAccessibility(input: AccessibilityAnalysisInput): AccessibilityAnalysisResult {
  const findings: AuditFinding[] = [];
  let score = 100;

  if (input.totalImages > 0 && input.imagesWithAlt < input.totalImages) {
    const missing = input.totalImages - input.imagesWithAlt;
    score -= Math.min(25, missing * 5);
    findings.push({
      category: 'accessibility',
      title: 'Images Missing Alt Text',
      description: 'Images lack `alt` attributes, making them inaccessible to screen readers and visually impaired visitors.',
      severity: 'MEDIUM',
      evidence: `${missing} image(s) without alt text`,
    });
  }

  if (input.unlabeledButtonsCount > 0) {
    score -= Math.min(25, input.unlabeledButtonsCount * 10);
    findings.push({
      category: 'accessibility',
      title: 'Buttons Missing Accessible Names',
      description: 'Interactive button elements lack descriptive text, `aria-label`, or title attributes.',
      severity: 'MEDIUM',
      evidence: `${input.unlabeledButtonsCount} unlabeled button(s)`,
    });
  }

  if (input.emptyLinksCount > 0) {
    score -= Math.min(20, input.emptyLinksCount * 5);
    findings.push({
      category: 'accessibility',
      title: 'Links Missing Descriptive Anchor Text',
      description: 'Navigation or text links contain no readable anchor text.',
      severity: 'LOW',
      evidence: `${input.emptyLinksCount} empty link(s)`,
    });
  }

  if (input.unlabeledInputsCount > 0) {
    score -= Math.min(30, input.unlabeledInputsCount * 10);
    findings.push({
      category: 'accessibility',
      title: 'Form Inputs Missing Associated Labels',
      description: 'Contact or lead form fields lack associated `<label>` or `aria-label` elements.',
      severity: 'HIGH',
      evidence: `${input.unlabeledInputsCount} unlabeled form input(s)`,
    });
  }

  return {
    score: Math.max(0, score),
    findings,
  };
}
