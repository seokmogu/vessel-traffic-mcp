export const providerCapabilityValues = [
  'provider_status',
  'data_sources',
  'vessel_search',
  'vessel_position',
  'vessel_area',
  'vessel_track',
  'port_calls',
] as const;

export type ProviderCapability = (typeof providerCapabilityValues)[number];

export const providerTransportValues = ['api', 'websocket', 'fixture', 'capture-fixture'] as const;

export type ProviderTransport = (typeof providerTransportValues)[number];

export const sourceConfidenceValues = ['high', 'medium', 'low', 'unknown'] as const;

export type SourceConfidence = (typeof sourceConfidenceValues)[number];

export interface SourceMetadata {
  provider: string;
  adapterVersion: string;
  transport: ProviderTransport;
  coverage?: string;
  confidence?: SourceConfidence;
  termsNote?: string;
}

export interface ProviderStatus {
  id: string;
  name: string;
  authState: 'not_required' | 'configured' | 'missing' | 'disabled';
  status: 'available' | 'degraded' | 'unavailable';
  capabilities: ProviderCapability[];
  source: SourceMetadata;
  retrievedAt: string;
  quota?: {
    state: 'not_applicable' | 'unknown' | 'available' | 'limited' | 'exhausted';
    note?: string;
  };
  caveats: string[];
}

export interface DataSource {
  id: string;
  name: string;
  transport: SourceMetadata['transport'];
  capabilities: ProviderCapability[];
  coverage: string;
  auth: {
    required: boolean;
    mode: 'none' | 'byok-profile' | 'one-time';
  };
  caveats: string[];
  source: SourceMetadata;
}

export interface VesselDataProvider {
  id: string;
  capabilities(): ProviderCapability[];
  status(): Promise<ProviderStatus>;
  dataSources(): Promise<DataSource[]>;
}
