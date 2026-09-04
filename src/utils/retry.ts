import { logger } from './logger.js';
import { sleep } from './sleeper.js';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  operationName?: string;
  isRetryable?: (error: unknown) => boolean;
}

/**
 * Detects if an error is a transient network or server error suitable for conservative retry.
 */
export function isTransientNetworkError(error: unknown): boolean {
  if (!error) return false;

  const errString = String(error).toLowerCase();
  const status = (error as any)?.status || (error as any)?.statusCode || (error as any)?.response?.status;

  // HTTP status codes that indicate transient issues
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  // Network timeouts / connection reset
  if (
    errString.includes('etimedout') ||
    errString.includes('econnreset') ||
    errString.includes('econnaborted') ||
    errString.includes('econnrefused') ||
    errString.includes('enotfound') ||
    errString.includes('timeout') ||
    errString.includes('socket hang up') ||
    errString.includes('network error')
  ) {
    return true;
  }

  return false;
}

/**
 * Explicit non-retryable check: Auth failures, policy blocks, email validation, human approval, etc.
 */
export function isExplicitlyNonRetryable(error: unknown): boolean {
  if (!error) return true;

  const errString = String(error).toUpperCase();
  const status = (error as any)?.status || (error as any)?.statusCode || (error as any)?.response?.status;

  // Auth / Forbidden
  if (status === 401 || status === 403) return true;

  if (
    errString.includes('UNSUPPORTED') ||
    errString.includes('POLICY') ||
    errString.includes('SUPPRESSED') ||
    errString.includes('COOLDOWN') ||
    errString.includes('AUTHENTICATION') ||
    errString.includes('INVALID_EMAIL') ||
    errString.includes('TEST_DATA_PROHIBITED') ||
    errString.includes('NOT_HUMAN_APPROVED') ||
    errString.includes('HUMAN_APPROVAL_REQUIRED') ||
    errString.includes('KILL_SWITCH_ACTIVE') ||
    errString.includes('OUTREACH_DISABLED') ||
    errString.includes('CAN_SPAM')
  ) {
    return true;
  }

  return false;
}

/**
 * Executes an async operation with bounded exponential backoff.
 * Strict rule: NEVER retry outbound email dispatches.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const initialDelay = options.initialDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 8000;
  const backoffFactor = options.backoffFactor ?? 2;
  const operationName = options.operationName ?? 'NetworkOperation';
  const customIsRetryable = options.isRetryable;

  let attempt = 0;
  let delay = initialDelay;

  while (true) {
    attempt++;
    try {
      return await operation();
    } catch (err) {
      // Check if non-retryable
      if (isExplicitlyNonRetryable(err)) {
        throw err;
      }

      const retryable = customIsRetryable ? customIsRetryable(err) : isTransientNetworkError(err);
      if (!retryable || attempt > maxRetries) {
        throw err;
      }

      // Add jitter to avoid thundering herds (±20%)
      const jitter = delay * 0.2 * (Math.random() * 2 - 1);
      const actualDelay = Math.min(Math.max(delay + jitter, 100), maxDelay);

      logger.warn(
        `[Retry] ${operationName} failed (attempt ${attempt}/${maxRetries}): ${err instanceof Error ? err.message : String(err)}. Retrying in ${Math.round(actualDelay)}ms...`
      );

      await sleep(actualDelay);
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }
}
