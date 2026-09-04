export class AppError extends Error {
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string = 'INTERNAL_ERROR',
    isOperational: boolean = true,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.isOperational = isOperational;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', false, context);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'DATABASE_ERROR', true, context);
  }
}

export class ProviderError extends AppError {
  constructor(providerName: string, message: string, context?: Record<string, unknown>) {
    super(`[${providerName}] ${message}`, 'PROVIDER_ERROR', true, context);
  }
}

export class SafetyViolationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'SAFETY_VIOLATION', false, context);
  }
}

export class DuplicateRecordError extends AppError {
  constructor(entity: string, details: string) {
    super(`${entity} already exists with details: ${details}`, 'DUPLICATE_RECORD', true);
  }
}

// ------------------------------------------------------------------------------
// Phase 13 Typed Domain Errors
// ------------------------------------------------------------------------------

export class CampaignNotFoundError extends AppError {
  constructor(campaignId: string, context?: Record<string, unknown>) {
    super(`Campaign not found: "${campaignId}".`, 'CAMPAIGN_NOT_FOUND', true, { campaignId, ...context });
  }
}

export class CampaignMarketMismatchError extends AppError {
  constructor(details: string, context?: Record<string, unknown>) {
    super(`Campaign market mismatch: ${details}`, 'CAMPAIGN_MARKET_MISMATCH', true, context);
  }
}

export class CampaignNicheMismatchError extends AppError {
  constructor(details: string, context?: Record<string, unknown>) {
    super(`Campaign niche mismatch: ${details}`, 'CAMPAIGN_NICHE_MISMATCH', true, context);
  }
}

export class BusinessIdentityUnsafeError extends AppError {
  constructor(businessName: string, reason: string, context?: Record<string, unknown>) {
    super(
      `Business identity unsafe for "${businessName}": ${reason}`,
      'BUSINESS_IDENTITY_UNSAFE',
      true,
      { businessName, reason, ...context }
    );
  }
}

export class EmailSourceNotVerifiableError extends AppError {
  constructor(email: string, sourceUrl?: string, context?: Record<string, unknown>) {
    super(
      `Email source cannot be verified: "${email}" (Source: ${sourceUrl || 'Unknown'}).`,
      'EMAIL_SOURCE_NOT_VERIFIABLE',
      true,
      { email, sourceUrl, ...context }
    );
  }
}

export class InvalidEmailContactError extends AppError {
  constructor(email: string, reason: string, context?: Record<string, unknown>) {
    super(`Invalid email contact "${email}": ${reason}`, 'INVALID_EMAIL_CONTACT', true, { email, reason, ...context });
  }
}

export class TestDataProhibitedError extends AppError {
  constructor(entityName: string, source: string, context?: Record<string, unknown>) {
    super(
      `TEST_DATA_PROHIBITED: Entity "${entityName}" originating from "${source}" cannot be processed in operational workflows.`,
      'TEST_DATA_PROHIBITED',
      false,
      { entityName, source, ...context }
    );
  }
}

export class ContentChangedAfterApprovalError extends AppError {
  constructor(draftId: string, context?: Record<string, unknown>) {
    super(
      `CONTENT_CHANGED_AFTER_APPROVAL: Draft "${draftId}" hash changed after explicit human approval. Dispatch blocked.`,
      'CONTENT_CHANGED_AFTER_APPROVAL',
      false,
      { draftId, ...context }
    );
  }
}

export class OutboundProviderPolicyUnsupportedError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(
      message ||
        'OUTBOUND_PROVIDER_POLICY_UNSUPPORTED: Provider does not support cold commercial outreach (e.g. personal Gmail prohibited by Google Program Policies).',
      'OUTBOUND_PROVIDER_POLICY_UNSUPPORTED',
      false,
      context
    );
  }
}

export class ProviderPolicyReviewRequiredError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(
      message ||
        'PROVIDER_POLICY_REVIEW_REQUIRED: Provider requires explicit policy and compliance review before commercial dispatch.',
      'PROVIDER_POLICY_REVIEW_REQUIRED',
      false,
      context
    );
  }
}

export class SuppressedError extends AppError {
  constructor(targetValue: string, reason: string, context?: Record<string, unknown>) {
    super(
      `SUPPRESSED: Recipient or business "${targetValue}" is suppressed (Reason: ${reason}).`,
      'SUPPRESSED',
      true,
      { targetValue, reason, ...context }
    );
  }
}

export class CooldownActiveError extends AppError {
  constructor(targetValue: string, daysRemaining: number, context?: Record<string, unknown>) {
    super(
      `COOLDOWN_ACTIVE: "${targetValue}" is in active outreach cooldown (${daysRemaining} day(s) remaining).`,
      'COOLDOWN_ACTIVE',
      true,
      { targetValue, daysRemaining, ...context }
    );
  }
}

export class DiscoveryTimeoutError extends AppError {
  constructor(source: string, timeoutMs: number, context?: Record<string, unknown>) {
    super(
      `DISCOVERY_TIMEOUT: Source query to "${source}" timed out after ${timeoutMs}ms.`,
      'DISCOVERY_TIMEOUT',
      true,
      { source, timeoutMs, ...context }
    );
  }
}

export class RateLimitError extends AppError {
  constructor(action: string, retryAfterMs: number, context?: Record<string, unknown>) {
    super(
      `RATE_LIMIT_ERROR: Rate limit exceeded for "${action}". Retry after ${retryAfterMs}ms.`,
      'RATE_LIMIT_EXCEEDED',
      true,
      { action, retryAfterMs, ...context }
    );
  }
}

/**
 * Formats any error into an operator-friendly presentation without exposing raw stack traces.
 */
export function formatErrorForOperator(err: unknown): { code: string; message: string; details?: unknown } {
  if (err instanceof AppError) {
    return {
      code: err.code,
      message: err.message,
      details: err.context,
    };
  }

  if (err instanceof Error) {
    return {
      code: 'UNHANDLED_ERROR',
      message: err.message,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: String(err),
  };
}
