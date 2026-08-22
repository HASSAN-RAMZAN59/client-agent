import { describe, it, expect } from 'vitest';
import { MockEmailProvider } from '../src/modules/gmail/mock-email.provider.js';
import { safetyControls } from '../src/config/safety.js';

describe('Global Dry-Run Safety Behavior', () => {
  it('should default to DRY_RUN=true in safety controls', () => {
    expect(safetyControls.isDryRun()).toBe(true);
  });

  it('should simulate email dispatch and not execute real sending when DRY_RUN=true', async () => {
    const emailProvider = new MockEmailProvider();

    const result = await emailProvider.sendEmail({
      to: 'client-test@example.com',
      subject: 'Audit Feedback',
      body: 'Hello, your website could benefit from mobile optimization.',
    });

    expect(result.status).toBe('SIMULATED');
    expect(result.recipient).toBe('client-test@example.com');
    expect(result.details).toContain('DRY_RUN mode');
  });
});
