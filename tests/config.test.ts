import { describe, it, expect } from 'vitest';
import { parseConfig } from '../src/config/env.js';
import { SafetyControls } from '../src/config/safety.js';

describe('Configuration & Safety Validation', () => {
  it('should parse valid environment variables with default values', () => {
    const parsed = parseConfig({
      DATABASE_URL: 'file:./test.db',
      DRY_RUN: 'true',
    });

    expect(parsed.DATABASE_URL).toBe('file:./test.db');
    expect(parsed.DRY_RUN).toBe(true);
    expect(parsed.MAX_ITEMS_PER_RUN).toBe(10);
    expect(parsed.MAX_EMAILS_PER_RUN).toBe(5);
    expect(parsed.MAX_RETRIES).toBe(3);
    expect(parsed.REQUEST_DELAY_MS).toBe(2000);
  });

  it('should enforce safety constraints on negative or invalid limits', () => {
    expect(() => {
      parseConfig({
        MAX_ITEMS_PER_RUN: '-5',
      });
    }).toThrow(/Configuration Validation Error/);

    expect(() => {
      parseConfig({
        REQUEST_DELAY_MS: '100', // below minimum 500ms safety threshold
      });
    }).toThrow(/Configuration Validation Error/);
  });

  it('should enforce safety controls batch checks', () => {
    const safety = SafetyControls.getInstance(
      parseConfig({
        MAX_ITEMS_PER_RUN: 5,
        MAX_EMAILS_PER_RUN: 2,
        DRY_RUN: 'true',
      })
    );

    expect(() => safety.assertAllowedBatchSize(10, 'TestBatch')).toThrow(
      /Safety Violation/
    );
    expect(() => safety.assertAllowedBatchSize(3, 'TestBatch')).not.toThrow();

    expect(() => safety.assertAllowedEmailBatch(5)).toThrow(/Safety Violation/);
    expect(() => safety.assertAllowedEmailBatch(2)).not.toThrow();
  });
});
