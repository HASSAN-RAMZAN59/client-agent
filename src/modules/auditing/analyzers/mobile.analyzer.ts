import { AuditFinding } from '../../../types/index.js';

export interface MobileAnalysisInput {
  hasViewportMeta: boolean;
  viewportContent?: string;
  hasHorizontalOverflow?: boolean;
  scrollWidth?: number;
  innerWidth?: number;
}

export interface MobileAnalysisResult {
  score: number;
  mobileResponsive: boolean;
  findings: AuditFinding[];
}

export function analyzeMobile(input: MobileAnalysisInput): MobileAnalysisResult {
  const findings: AuditFinding[] = [];
  let score = 100;

  if (!input.hasViewportMeta) {
    score -= 60;
    findings.push({
      category: 'mobile',
      title: 'Missing Mobile Viewport Meta Tag',
      description: 'The page does not declare a `<meta name="viewport">` tag. Mobile browsers will render the page scaled out as desktop width.',
      severity: 'HIGH',
      evidence: 'No <meta name="viewport"> found in <head>',
    });
  } else if (input.viewportContent && !input.viewportContent.includes('width=device-width')) {
    score -= 25;
    findings.push({
      category: 'mobile',
      title: 'Non-Standard Viewport Configuration',
      description: 'The viewport tag does not specify `width=device-width`, which can cause inconsistent mobile scaling.',
      severity: 'MEDIUM',
      evidence: `<meta name="viewport" content="${input.viewportContent}">`,
    });
  }

  if (input.hasHorizontalOverflow) {
    score -= 40;
    findings.push({
      category: 'mobile',
      title: 'Horizontal Layout Overflow',
      description: 'Page elements exceed the mobile screen width, forcing users to pinch or scroll horizontally.',
      severity: 'HIGH',
      evidence: `DOM scrollWidth (${input.scrollWidth}px) exceeds viewport innerWidth (${input.innerWidth}px)`,
    });
  }

  const mobileResponsive = score >= 60;

  return {
    score: Math.max(0, score),
    mobileResponsive,
    findings,
  };
}
