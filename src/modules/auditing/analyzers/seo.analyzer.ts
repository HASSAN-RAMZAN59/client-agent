import { AuditFinding } from '../../../types/index.js';

export interface SeoAnalysisInput {
  title?: string;
  metaDescription?: string;
  h1List: string[];
  canonicalUrl?: string;
  hasRobotsMetaNoindex: boolean;
  totalImages: number;
  imagesWithAlt: number;
}

export interface SeoAnalysisResult {
  score: number;
  findings: AuditFinding[];
}

export function analyzeSeo(input: SeoAnalysisInput): SeoAnalysisResult {
  const findings: AuditFinding[] = [];
  let score = 100;

  // 1. Title tag analysis
  if (!input.title || input.title.trim().length === 0) {
    score -= 30;
    findings.push({
      category: 'seo',
      title: 'Missing Page Title Tag',
      description: 'The homepage lacks a `<title>` tag. Search engines cannot identify the primary topic or business name.',
      severity: 'HIGH',
      evidence: '<title> tag is missing or empty',
    });
  } else if (input.title.length < 15) {
    score -= 15;
    findings.push({
      category: 'seo',
      title: 'Title Tag Too Short',
      description: 'Page title is under 15 characters and likely lacks business and locality context for local search.',
      severity: 'LOW',
      evidence: `Title: "${input.title}" (${input.title.length} characters)`,
    });
  } else if (input.title.length > 70) {
    score -= 10;
    findings.push({
      category: 'seo',
      title: 'Title Tag Truncated in SERP',
      description: 'Page title exceeds 70 characters and may be truncated on search engine result pages.',
      severity: 'LOW',
      evidence: `Title length: ${input.title.length} chars (> 70)`,
    });
  }

  // 2. Meta Description
  if (!input.metaDescription || input.metaDescription.trim().length === 0) {
    score -= 25;
    findings.push({
      category: 'seo',
      title: 'Missing Meta Description',
      description: 'No `<meta name="description">` found. Search engines will auto-generate snippets which reduces click-through rates.',
      severity: 'MEDIUM',
      evidence: 'No meta description tag in <head>',
    });
  }

  // 3. H1 Headings
  if (input.h1List.length === 0) {
    score -= 20;
    findings.push({
      category: 'seo',
      title: 'Missing Main Heading (H1)',
      description: 'The page does not have an `<h1>` heading tag defining the main value proposition.',
      severity: 'MEDIUM',
      evidence: '0 <h1> tags found',
    });
  } else if (input.h1List.length > 2) {
    score -= 10;
    findings.push({
      category: 'seo',
      title: 'Multiple H1 Headings',
      description: 'Found multiple `<h1>` elements. Best practice for search engines is a single clear primary H1 per page.',
      severity: 'LOW',
      evidence: `${input.h1List.length} <h1> tags detected on homepage`,
    });
  }

  // 4. Image Alt Coverage
  if (input.totalImages > 0) {
    const missingAltCount = input.totalImages - input.imagesWithAlt;
    const missingAltPct = (missingAltCount / input.totalImages) * 100;
    if (missingAltPct > 40) {
      score -= 15;
      findings.push({
        category: 'seo',
        title: 'Missing Image Alt Text for Image Search',
        description: 'A significant portion of images lack `alt` attributes for indexing.',
        severity: 'LOW',
        evidence: `${missingAltCount} of ${input.totalImages} images (${Math.round(missingAltPct)}%) missing alt attribute`,
      });
    }
  }

  // 5. Indexing blockers
  if (input.hasRobotsMetaNoindex) {
    score -= 50;
    findings.push({
      category: 'seo',
      title: 'Page Blocked from Indexing (noindex)',
      description: 'The homepage declares `noindex` in robots meta tag, preventing Google and Bing from indexing the business.',
      severity: 'HIGH',
      evidence: '<meta name="robots" content="...noindex..."> detected',
    });
  }

  return {
    score: Math.max(0, score),
    findings,
  };
}
