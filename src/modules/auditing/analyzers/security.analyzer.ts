import { AuditFinding } from '../../../types/index.js';

export interface SecurityAnalysisResult {
  score: number;
  isHttps: boolean;
  hasMixedContent: boolean;
  findings: AuditFinding[];
}

export function analyzeSecurity(url: string, html: string): SecurityAnalysisResult {
  const findings: AuditFinding[] = [];
  let score = 100;

  const isHttps = url.toLowerCase().startsWith('https://');

  if (!isHttps) {
    score -= 60;
    findings.push({
      category: 'technical',
      title: 'Insecure Connection (HTTP)',
      description: 'The website is served over insecure HTTP instead of HTTPS, causing modern browsers to mark it as Not Secure.',
      severity: 'HIGH',
      evidence: `Protocol is ${url.split(':')[0]}://`,
    });
  }

  // Check for insecure mixed-content asset references in HTML
  const insecureScriptMatch = html.match(/<script[^>]+src=["']http:\/\/[^"']+/i);
  const insecureLinkMatch = html.match(/<link[^>]+href=["']http:\/\/[^"']+/i);
  const hasMixedContent = Boolean(isHttps && (insecureScriptMatch || insecureLinkMatch));

  if (hasMixedContent) {
    score -= 25;
    findings.push({
      category: 'technical',
      title: 'Mixed Content Detected',
      description: 'The HTTPS page attempts to load active scripts or stylesheets over unencrypted HTTP.',
      severity: 'MEDIUM',
      evidence: (insecureScriptMatch ? insecureScriptMatch[0] : insecureLinkMatch?.[0]) || 'Insecure HTTP asset links',
    });
  }

  return {
    score: Math.max(0, score),
    isHttps,
    hasMixedContent,
    findings,
  };
}
