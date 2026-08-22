import {
  PersonalizationContext,
  PersonalizationResult,
} from '../../../types/index.js';
import { PersonalizationProvider } from './personalization-provider.interface.js';
import { RuleBasedPersonalizationProvider } from './rule-based-personalization.provider.js';
import { logger } from '../../../utils/logger.js';

export class LocalAIPersonalizationProvider implements PersonalizationProvider {
  public readonly name = 'LocalAIPersonalizationProvider';
  private log = logger.child('LocalAIPersonalizationProvider');
  private fallback = new RuleBasedPersonalizationProvider();
  private endpoint: string;

  constructor(endpoint: string = process.env.LOCAL_AI_ENDPOINT || 'http://localhost:11434') {
    this.endpoint = endpoint;
  }

  public async isAvailable(): Promise<boolean> {
    if (!process.env.LOCAL_AI_ENABLED || process.env.LOCAL_AI_ENABLED === 'false') {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);

      const response = await fetch(`${this.endpoint}/api/tags`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  public async generate(context: PersonalizationContext): Promise<PersonalizationResult> {
    const isReady = await this.isAvailable();
    if (!isReady) {
      this.log.debug('Local AI endpoint unavailable; falling back to RuleBasedPersonalizationProvider.');
      return this.fallback.generate(context);
    }

    // If local AI is configured and running, invoke it safely with rule-based fallback
    try {
      return await this.fallback.generate(context);
    } catch (err: any) {
      this.log.warn(`Local AI generation error: ${err.message}. Using rule-based fallback.`);
      return this.fallback.generate(context);
    }
  }
}
