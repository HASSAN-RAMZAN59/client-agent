import {
  ReplyClassifierProvider,
  ReplyClassification,
} from '../../types/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Mock reply classifier provider.
 * Evaluates sentiment and categorizes email responses (positive interest, bounce, unsubscribe, etc.).
 */
export class MockReplyClassifierProvider implements ReplyClassifierProvider {
  public readonly providerName = 'MockReplyClassifierProvider';
  private log = logger.child('Replies');

  public async classify(emailBody: string): Promise<{
    classification: ReplyClassification;
    confidence: number;
    sentimentScore: number;
  }> {
    this.log.info(`Classifying inbound response body (length=${emailBody.length})`);

    const lower = emailBody.toLowerCase();

    if (
      lower.includes('unsubscribe') ||
      lower.includes('not interested') ||
      lower.includes('remove me')
    ) {
      return {
        classification: 'NOT_INTERESTED',
        confidence: 0.95,
        sentimentScore: -0.7,
      };
    }

    if (
      lower.includes('call') ||
      lower.includes('send more info') ||
      lower.includes('interested') ||
      lower.includes('pricing') ||
      lower.includes('let\'s talk') ||
      lower.includes('available')
    ) {
      return {
        classification: 'POSITIVE_INTEREST',
        confidence: 0.9,
        sentimentScore: 0.85,
      };
    }

    if (
      lower.includes('wrong email') ||
      lower.includes('no longer with') ||
      lower.includes('left the company')
    ) {
      return {
        classification: 'WRONG_PERSON',
        confidence: 0.85,
        sentimentScore: 0.0,
      };
    }

    return {
      classification: 'UNCLASSIFIED',
      confidence: 0.5,
      sentimentScore: 0.0,
    };
  }
}
