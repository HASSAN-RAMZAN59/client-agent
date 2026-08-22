import { createHash } from 'crypto';

export class ContentHasher {
  /**
   * Generates a deterministic SHA-256 hash of normalized subject and body text.
   */
  public static hashDraft(subject: string, body: string): string {
    const normalizedSubject = subject.trim().toLowerCase().replace(/\s+/g, ' ');
    const normalizedBody = body.trim().toLowerCase().replace(/\s+/g, ' ');
    const combined = `${normalizedSubject}:::${normalizedBody}`;

    return createHash('sha256').update(combined).digest('hex');
  }
}
