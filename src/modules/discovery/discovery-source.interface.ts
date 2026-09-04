import {
  BusinessDiscoveryQuery,
  DiscoveredBusinessInput,
  SourceStatus,
  DiscoverySourceOutcome,
} from '../../types/index.js';

export type DiscoverySourceType =
  | 'geodata'
  | 'search_engine'
  | 'public_directory'
  | 'mock';

export interface SourceMetrics {
  requestsCount: number;
  successfulCount: number;
  failedCount: number;
  blockedCount: number;
  itemsDiscovered: number;
}

export interface DiscoverySource {
  readonly name: string;
  readonly type: DiscoverySourceType;
  enabled: boolean;
  priority: number;
  status: SourceStatus;

  isAvailable(): boolean;
  markBlocked(reason: string, status?: 'BLOCKED' | 'RATE_LIMITED' | 'ERROR'): void;
  resetStatus(): void;

  getMetrics(): Readonly<SourceMetrics>;
  resetMetrics(): void;

  getOutcome?(): DiscoverySourceOutcome;

  discover(query: BusinessDiscoveryQuery): Promise<DiscoveredBusinessInput[]>;
}
