import {
  PersonalizationContext,
  QualityBand,
  OutreachVariant,
} from '../../../types/index.js';
import { OutreachQualityGuard } from '../quality-guard.js';

export interface QualityEvaluationResult {
  score: number;
  qualityBand: QualityBand;
  breakdown: Record<string, number>;
  warnings: string[];
  blockedReasons: string[];
}

export class OutreachQualityEvaluator {
  public static evaluate(params: {
    subject: string;
    body: string;
    variant: OutreachVariant;
    context: PersonalizationContext;
    evidenceValid: boolean;
    identityValid: boolean;
  }): QualityEvaluationResult {
    const { subject, body, variant, context, evidenceValid, identityValid } = params;
    const breakdown: Record<string, number> = {};
    const warnings: string[] = [];
    const blockedReasons: string[] = [];

    // 1. Business-Specific Personalization (Max 15)
    let businessScore = 0;
    if (context.business.name && body.includes(context.business.name)) {
      businessScore += 10;
    }
    if (context.business.city && body.includes(context.business.city)) {
      businessScore += 5;
    }
    breakdown['businessPersonalization'] = businessScore;

    // 2. Evidence-Backed Observations (Max 20)
    let evidenceScore = 0;
    if (evidenceValid) {
      if (context.audit && context.audit.topProblems.length > 0) {
        evidenceScore += 20;
      } else if (context.lead.topOpportunitySignals.length > 0) {
        evidenceScore += 15;
      } else {
        evidenceScore += 10;
      }
    } else {
      blockedReasons.push('Draft contains unsupported factual assertions.');
      evidenceScore = 0;
    }
    breakdown['evidenceBacking'] = evidenceScore;

    // 3. Business Name & Website Relevance (Max 15)
    let relevanceScore = 0;
    if (identityValid) {
      relevanceScore += 15;
    } else {
      relevanceScore += 5;
      warnings.push('Identity validation was incomplete or non-matching.');
    }
    breakdown['identityRelevance'] = relevanceScore;

    // 4. Contact Validity (Max 10)
    let contactScore = 0;
    if (context.contact.value && context.contact.value !== 'NONE_FOUND') {
      if (context.contact.qualityScore >= 80) {
        contactScore += 10;
      } else {
        contactScore += 6;
      }
    } else {
      warnings.push('No verified direct contact found; requires manual review.');
      contactScore = 0;
    }
    breakdown['contactValidity'] = contactScore;

    // 5. Relevant Service Fit Alignment (Max 15)
    let serviceScore = 0;
    if (context.lead.recommendedService && context.lead.recommendedService !== 'NO_CLEAR_SERVICE_FIT') {
      serviceScore += 15;
    } else {
      serviceScore += 5;
      warnings.push('Lead does not have a distinct recommended service match.');
    }
    breakdown['serviceFit'] = serviceScore;

    // 6. Conciseness & Readability (Max 10)
    let readabilityScore = 0;
    const wordCount = body.trim().split(/\s+/).length;
    if (variant === 'VARIANT_A_SHORT') {
      readabilityScore = wordCount >= 35 && wordCount <= 90 ? 10 : 5;
    } else if (variant === 'VARIANT_B_STANDARD') {
      readabilityScore = wordCount >= 65 && wordCount <= 160 ? 10 : 6;
    } else {
      readabilityScore = wordCount >= 85 && wordCount <= 220 ? 10 : 6;
    }
    breakdown['conciseness'] = readabilityScore;

    // 7. Clear, Low-Pressure CTA (Max 10)
    let ctaScore = 0;
    if (/\b(?:open to|worth a|quick|sample|preview|feedback|thoughts)\b/i.test(body)) {
      ctaScore += 10;
    } else {
      ctaScore += 4;
      warnings.push('Call to action may be overly passive or unclear.');
    }
    breakdown['ctaQuality'] = ctaScore;

    // 8. Quality Guard Check (Max 5)
    const qGuard = OutreachQualityGuard.evaluate(subject, body);
    let guardScore = qGuard.passed ? 5 : 0;
    if (!qGuard.passed) {
      blockedReasons.push(...qGuard.blockedReasons);
      warnings.push(...qGuard.warnings);
    }
    breakdown['qualityGuard'] = guardScore;

    // Total Quality Score Calculation
    let rawScore = Object.values(breakdown).reduce((sum, val) => sum + val, 0);

    if (blockedReasons.length > 0) {
      rawScore = Math.min(55, rawScore);
    }

    const finalScore = Math.min(100, Math.max(0, Math.round(rawScore)));

    // Assign Quality Band
    let qualityBand: QualityBand = 'REVIEW_REQUIRED';
    if (finalScore >= 90 && blockedReasons.length === 0) {
      qualityBand = 'EXCELLENT';
    } else if (finalScore >= 75 && blockedReasons.length === 0) {
      qualityBand = 'GOOD';
    } else if (finalScore >= 60 && blockedReasons.length === 0) {
      qualityBand = 'REVIEW_REQUIRED';
    } else {
      qualityBand = 'REJECTED';
    }

    return {
      score: finalScore,
      qualityBand,
      breakdown,
      warnings,
      blockedReasons,
    };
  }
}
