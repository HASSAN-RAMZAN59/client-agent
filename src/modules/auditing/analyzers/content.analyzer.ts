import { AuditFinding } from '../../../types/index.js';

export interface ContentAnalysisInput {
  bodyWordCount: number;
  hasPlaceholderText: boolean;
  placeholderMatches: string[];
  hasEmptySections: boolean;
}

export interface ContentAnalysisResult {
  score: number;
  findings: AuditFinding[];
}

export function analyzeContent(input: ContentAnalysisInput): ContentAnalysisResult {
  const findings: AuditFinding[] = [];
  let score = 100;

  if (input.hasPlaceholderText) {
    score -= 50;
    findings.push({
      category: 'content',
      title: 'Placeholder / Demo Content Detected',
      description: 'The website contains unfinished template text (such as "Lorem Ipsum" or "Sample Text").',
      severity: 'HIGH',
      evidence: `Detected phrases: ${input.placeholderMatches.slice(0, 3).join(', ')}`,
    });
  }

  if (input.bodyWordCount < 80) {
    score -= 40;
    findings.push({
      category: 'content',
      title: 'Critically Thin Homepage Content',
      description: 'The homepage contains less than 80 words of visible text, failing to explain services to customers and search engines.',
      severity: 'HIGH',
      evidence: `Total visible words: ${input.bodyWordCount} (< 80 words minimum)`,
    });
  } else if (input.bodyWordCount < 180) {
    score -= 15;
    findings.push({
      category: 'content',
      title: 'Thin Service Description Content',
      description: 'Homepage content is under 180 words, which may lead to low engagement.',
      severity: 'LOW',
      evidence: `Total visible words: ${input.bodyWordCount}`,
    });
  }

  if (input.hasEmptySections) {
    score -= 20;
    findings.push({
      category: 'content',
      title: 'Empty Layout Containers / Incomplete Sections',
      description: 'Detected layout sections without substantive text or content.',
      severity: 'MEDIUM',
      evidence: 'Empty structural <div> or <section> blocks found',
    });
  }

  return {
    score: Math.max(0, score),
    findings,
  };
}
