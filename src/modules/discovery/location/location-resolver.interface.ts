import { CountryMarketProfile } from '../../../config/markets.js';

export interface LocationResolutionInput {
  city: string;
  stateOrProvince?: string;
  country?: string;
  radiusKm?: number;
}

export type LocationResolutionStatus =
  | 'RESOLVED_AREA'
  | 'RESOLVED_CENTER'
  | 'LOCATION_RESOLUTION_FAILED'
  | 'LOCATION_AMBIGUOUS'
  | 'RATE_LIMITED'
  | 'BLOCKED';

export type LocationResolutionType = 'ADMINISTRATIVE_AREA' | 'CENTER_RADIUS' | 'NONE';

export interface ResolvedLocation {
  status: LocationResolutionStatus;
  canonicalCountryCode: string;
  canonicalCountryName: string;
  city: string;
  stateOrProvince?: string;
  resolutionType: LocationResolutionType;
  areaName?: string;
  adminLevel?: string;
  osmAreaId?: number;
  center?: {
    lat: number;
    lon: number;
  };
  radiusKm: number;
  radiusMeters: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  details?: string;
  matchedPlaceType?: string;
}

export interface OverpassElementCandidate {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export type OverpassQueryExecutor = (query: string) => Promise<OverpassElementCandidate[]>;
