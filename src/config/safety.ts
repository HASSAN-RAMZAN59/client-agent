import { config, EnvConfig } from './env.js';

export interface SafetyPolicy {
  isDryRun: boolean;
  maxItemsPerRun: number;
  requestDelayMs: number;
  maxRetries: number;
  cooldownMs: number;
  maxEmailsPerRun: number;
  // Phase 2.5 Discovery safety
  discoveryOsmEnabled: boolean;
  discoveryDdgEnabled: boolean;
  discoveryUserAgent: string;
  maxSourceRequestPerRun: number;
  sourceMaxRequestsPerRun: number;
  sourceMinDelayMs: number;
  sourceMaxRetries: number;
  // Phase 8 Discovery Volume & Coverage Optimization
  maxDiscoveryQueriesPerRun: number;
  maxResultsPerQuery: number;
  discoveryRequestDelayMs: number;
  discoveryExcludedDomains: string;
  // Phase 3 Website Auditing Safety
  auditHeadless: boolean;
  auditPageTimeoutMs: number;
  auditMaxPagesPerSite: number;
  auditViewportWidth: number;
  auditViewportHeight: number;
  auditReAuditIntervalDays: number;
}

/**
 * Safety controls manager to safeguard against runaway execution,
 * unintended outbound communications, and excessive local/remote resource usage.
 */
export class SafetyControls {
  private static instance: SafetyControls;
  private policy: SafetyPolicy;

  private constructor(cfg: EnvConfig = config) {
    this.policy = {
      isDryRun: cfg.DRY_RUN,
      maxItemsPerRun: cfg.MAX_ITEMS_PER_RUN,
      requestDelayMs: cfg.REQUEST_DELAY_MS,
      maxRetries: cfg.MAX_RETRIES,
      cooldownMs: cfg.COOLDOWN_MS,
      maxEmailsPerRun: cfg.MAX_EMAILS_PER_RUN,
      discoveryOsmEnabled: cfg.DISCOVERY_OSM_ENABLED,
      discoveryDdgEnabled: cfg.DISCOVERY_DDG_ENABLED,
      discoveryUserAgent: cfg.DISCOVERY_USER_AGENT,
      maxSourceRequestPerRun: cfg.MAX_SOURCE_REQUESTS_PER_RUN,
      sourceMaxRequestsPerRun: cfg.SOURCE_MAX_REQUESTS_PER_RUN,
      sourceMinDelayMs: cfg.SOURCE_MIN_DELAY_MS,
      sourceMaxRetries: cfg.SOURCE_MAX_RETRIES,
      maxDiscoveryQueriesPerRun: cfg.MAX_DISCOVERY_QUERIES_PER_RUN,
      maxResultsPerQuery: cfg.MAX_RESULTS_PER_QUERY,
      discoveryRequestDelayMs: cfg.DISCOVERY_REQUEST_DELAY_MS,
      discoveryExcludedDomains: cfg.DISCOVERY_EXCLUDED_DOMAINS || '',
      auditHeadless: cfg.AUDIT_HEADLESS,
      auditPageTimeoutMs: cfg.AUDIT_PAGE_TIMEOUT_MS,
      auditMaxPagesPerSite: cfg.AUDIT_MAX_PAGES_PER_SITE,
      auditViewportWidth: cfg.AUDIT_VIEWPORT_WIDTH,
      auditViewportHeight: cfg.AUDIT_VIEWPORT_HEIGHT,
      auditReAuditIntervalDays: cfg.AUDIT_RE_AUDIT_INTERVAL_DAYS,
    };
  }

  public static getInstance(customConfig?: EnvConfig): SafetyControls {
    if (!SafetyControls.instance || customConfig) {
      SafetyControls.instance = new SafetyControls(customConfig);
    }
    return SafetyControls.instance;
  }

  public getPolicy(): Readonly<SafetyPolicy> {
    return { ...this.policy };
  }

  public isDryRun(): boolean {
    return this.policy.isDryRun;
  }

  public assertAllowedBatchSize(count: number, label: string = 'Operation'): void {
    if (count > this.policy.maxItemsPerRun) {
      throw new Error(
        `Safety Violation: ${label} requested ${count} items, exceeding MAX_ITEMS_PER_RUN limit of ${this.policy.maxItemsPerRun}.`
      );
    }
  }

  public assertAllowedEmailBatch(count: number): void {
    if (count > this.policy.maxEmailsPerRun) {
      throw new Error(
        `Safety Violation: Email batch size of ${count} exceeds MAX_EMAILS_PER_RUN limit of ${this.policy.maxEmailsPerRun}.`
      );
    }
  }
}

export const safetyControls = SafetyControls.getInstance();
