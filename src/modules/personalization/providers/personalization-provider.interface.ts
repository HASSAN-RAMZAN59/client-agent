import {
  PersonalizationContext,
  PersonalizationResult,
} from '../../../types/index.js';

export interface PersonalizationProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  generate(context: PersonalizationContext): Promise<PersonalizationResult>;
}
