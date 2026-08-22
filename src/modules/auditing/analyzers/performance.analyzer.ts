import { AuditFinding } from '../../../types/index.js';

export interface PerformanceAnalysisInput {
  loadTimeMs: number;
  domContentLoadedMs?: number;
  responseStatus?: number;
  pageSizeBytes?: number;
}

export interface PerformanceAnalysisResult {
  score: number;
  loadTimeMs: number;
  findings: AuditFinding[];
}

export function analyzePerformance(input: PerformanceAnalysisInput): PerformanceAnalysisResult {
  const findings: AuditFinding[] = [];
  const loadTimeMs = input.loadTimeMs || 1000;
  let score = 100;

  if (loadTimeMs > 4500) {
    score -= 55;
    findings.push({
      category: 'performance',
      title: 'Critical Page Load Latency',
      description: 'The homepage takes more than 4.5 seconds to load, leading to high bounce rates on mobile networks.',
      severity: 'HIGH',
      evidence: `Initial page load completed in ${(loadTimeMs / 1000).toFixed(2)}s (> 4.5s target)`,
    });
  } else if (loadTimeMs > 2500) {
    score -= 30;
    findings.push({
      category: 'performance',
      title: 'Sub-Optimal Page Load Speed',
      description: 'Page load time is above recommended 2.5 second mobile threshold.',
      severity: 'MEDIUM',
      evidence: `Page load took ${(loadTimeMs / 1000).toFixed(2)}s`,
    });
  } else if (loadTimeMs > 1500) {
    score -= 10;
  }

  if (input.pageSizeBytes && input.pageSizeBytes > 4 * 1024 * 1024) {
    score -= 20;
    findings.push({
      category: 'performance',
      title: 'Excessive Total Page Weight',
      description: 'The initial page download size exceeds 4MB, which consumes excessive bandwidth on mobile devices.',
      severity: 'MEDIUM',
      evidence: `Total HTML payload size: ${(input.pageSizeBytes / (1024 * 1024)).toFixed(1)}MB`,
    });
  }

  return {
    score: Math.max(0, score),
    loadTimeMs,
    findings,
  };
}
