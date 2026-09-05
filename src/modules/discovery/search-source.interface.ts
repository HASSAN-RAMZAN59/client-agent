import { DiscoverySource } from './discovery-source.interface.js';
import { SourceStatus } from '../../types/index.js';

export interface SearchProviderReport {
  provider: 'DUCKDUCKGO' | 'BROWSER_SEARCH';
  status: SourceStatus;
  queriesAttempted: number;
  rawResults: number;
  acceptedCandidates: number;
  blocked: boolean;
  errorCode?: string;
}

export interface SearchDiscoverySource extends DiscoverySource {
  readonly provider: 'DUCKDUCKGO' | 'BROWSER_SEARCH';
  getProviderReport(): SearchProviderReport;
}
