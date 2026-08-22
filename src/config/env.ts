import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const envSchema = z.object({
  // Database Configuration
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .default('file:./dev.db'),

  // Environment & Logging
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'])
    .default('info'),

  // Safety Controls (Conservative Defaults)
  DRY_RUN: z
    .string()
    .or(z.boolean())
    .transform((val) => {
      if (typeof val === 'boolean') return val;
      return val === 'true' || val === '1';
    })
    .default(true),

  MAX_ITEMS_PER_RUN: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val > 0, 'MAX_ITEMS_PER_RUN must be a positive integer')
    .default(10),

  REQUEST_DELAY_MS: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val >= 500, 'REQUEST_DELAY_MS must be at least 500ms for safety')
    .default(2000),

  MAX_RETRIES: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val >= 0 && val <= 10, 'MAX_RETRIES must be between 0 and 10')
    .default(3),

  COOLDOWN_MS: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val >= 1000, 'COOLDOWN_MS must be at least 1000ms')
    .default(5000),

  MAX_EMAILS_PER_RUN: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val > 0 && val <= 50, 'MAX_EMAILS_PER_RUN must be between 1 and 50')
    .default(5),

  // Phase 2.5 Discovery Safety & Kill Switches
  DISCOVERY_OSM_ENABLED: z
    .string()
    .or(z.boolean())
    .transform((val) => {
      if (typeof val === 'boolean') return val;
      return val === 'true' || val === '1';
    })
    .default(true),

  DISCOVERY_DDG_ENABLED: z
    .string()
    .or(z.boolean())
    .transform((val) => {
      if (typeof val === 'boolean') return val;
      return val === 'true' || val === '1';
    })
    .default(true),

  DISCOVERY_USER_AGENT: z
    .string()
    .default('LeadGenAutomation/0.2.0 (Public Research; https://github.com)'),

  MAX_SOURCE_REQUESTS_PER_RUN: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val > 0, 'MAX_SOURCE_REQUESTS_PER_RUN must be positive')
    .default(20),

  SOURCE_MAX_REQUESTS_PER_RUN: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val > 0, 'SOURCE_MAX_REQUESTS_PER_RUN must be positive')
    .default(10),

  SOURCE_MIN_DELAY_MS: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val >= 500, 'SOURCE_MIN_DELAY_MS must be at least 500ms')
    .default(1500),

  SOURCE_MAX_RETRIES: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val >= 0 && val <= 3, 'SOURCE_MAX_RETRIES must be between 0 and 3')
    .default(1),

  // Phase 3 Website Auditing Configuration
  AUDIT_HEADLESS: z
    .string()
    .or(z.boolean())
    .transform((val) => {
      if (typeof val === 'boolean') return val;
      return val === 'true' || val === '1';
    })
    .default(true),

  AUDIT_PAGE_TIMEOUT_MS: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val >= 3000, 'AUDIT_PAGE_TIMEOUT_MS must be >= 3000ms')
    .default(15000),

  AUDIT_MAX_PAGES_PER_SITE: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val >= 1 && val <= 5, 'AUDIT_MAX_PAGES_PER_SITE must be 1 to 5')
    .default(2),

  AUDIT_VIEWPORT_WIDTH: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .default(390),

  AUDIT_VIEWPORT_HEIGHT: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .default(844),

  AUDIT_RE_AUDIT_INTERVAL_DAYS: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .default(7),

  // Phase 5 Contact Discovery Configuration
  MAX_CONTACTS_PER_RUN: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val > 0, 'MAX_CONTACTS_PER_RUN must be positive')
    .default(10),

  MAX_CONTACT_PAGES_PER_BUSINESS: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val >= 1 && val <= 5, 'MAX_CONTACT_PAGES_PER_BUSINESS must be 1 to 5')
    .default(3),

  CONTACT_MIN_DELAY_MS: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val >= 500, 'CONTACT_MIN_DELAY_MS must be at least 500ms')
    .default(2000),

  // Phase 6.5 Outreach Hardening, Cooldowns & Global Safety Limits
  OUTREACH_ENABLED: z
    .string()
    .or(z.boolean())
    .transform((val) => {
      if (typeof val === 'boolean') return val;
      return val === 'true' || val === '1';
    })
    .default(false),

  OUTREACH_BUSINESS_COOLDOWN_DAYS: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val >= 1, 'OUTREACH_BUSINESS_COOLDOWN_DAYS must be >= 1')
    .default(30),

  OUTREACH_CONTACT_COOLDOWN_DAYS: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val >= 1, 'OUTREACH_CONTACT_COOLDOWN_DAYS must be >= 1')
    .default(30),

  OUTREACH_DRAFT_EXPIRATION_DAYS: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val >= 1, 'OUTREACH_DRAFT_EXPIRATION_DAYS must be >= 1')
    .default(14),

  OUTREACH_MIN_DELAY_MS: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val >= 1000, 'OUTREACH_MIN_DELAY_MS must be at least 1000ms')
    .default(3000),

  OUTREACH_COOLDOWN_MS: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val >= 1000, 'OUTREACH_COOLDOWN_MS must be at least 1000ms')
    .default(5000),

  MAX_EMAILS_PER_DAY: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .refine((val) => !isNaN(val) && val > 0 && val <= 200, 'MAX_EMAILS_PER_DAY must be between 1 and 200')
    .default(20),

  // Phase 7 SMTP Delivery Provider Configuration
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z
    .string()
    .or(z.number())
    .transform((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
    .default(587),
  SMTP_SECURE: z
    .string()
    .or(z.boolean())
    .transform((val) => {
      if (typeof val === 'boolean') return val;
      return val === 'true' || val === '1';
    })
    .default(false),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM_NAME: z.string().default('Alex Morgan'),
  SMTP_FROM_EMAIL: z.string().default('alex@modernwebstudio.com'),

  // Future Module Placeholders
  GMAIL_CLIENT_ID: z.string().optional().default(''),
  GMAIL_CLIENT_SECRET: z.string().optional().default(''),
  GMAIL_REDIRECT_URI: z.string().optional().default('http://localhost:3000/oauth2callback'),

  AI_PROVIDER: z.string().optional().default(''),
  AI_API_KEY: z.string().optional().default(''),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validates and returns parsed environment variables.
 */
export function parseConfig(overrides?: Partial<Record<keyof EnvConfig, unknown>>): EnvConfig {
  const source = overrides ? { ...process.env, ...overrides } : process.env;
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const errorDetails = result.error.errors
      .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(`Configuration Validation Error:\n${errorDetails}`);
  }

  return result.data;
}

export const config: EnvConfig = parseConfig();
