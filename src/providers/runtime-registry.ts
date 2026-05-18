import type { CredentialStore } from '../config/credentials.js';
import { createFixtureProvider } from './fixture.js';
import { createMarineTrafficProvider, MARINETRAFFIC_DEFAULT_LABEL } from './marinetraffic.js';
import { createMyShipTrackingProvider } from './myshiptracking.js';
import { createProviderRegistry, type ProviderRegistry } from './registry.js';
import { createShipFinderProvider } from './shipfinder.js';
import { createTradlinxScheduleProvider } from './tradlinx.js';
import type { VesselDataProvider } from './types.js';

export const PUBLIC_PROVIDERS_ENV = 'VESSEL_MCP_ENABLE_PUBLIC_PROVIDERS';
export const BYOK_PROVIDERS_ENV = 'VESSEL_MCP_ENABLE_BYOK_PROVIDERS';

const publicProviderFactories = {
  myshiptracking: createMyShipTrackingProvider,
  shipfinder: createShipFinderProvider,
  'tradlinx-schedule': createTradlinxScheduleProvider,
} as const;

type PublicProviderId = keyof typeof publicProviderFactories;

const byokProviderIds = ['marinetraffic'] as const;
type ByokProviderId = (typeof byokProviderIds)[number];

function parsePublicProviderIds(value: string | undefined): Set<PublicProviderId> {
  const enabled = new Set<PublicProviderId>();
  if (!value) return enabled;

  const tokens = value
    .split(/[,\s]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.some((token) => token === '1' || token === 'true' || token === 'all')) {
    for (const id of Object.keys(publicProviderFactories) as PublicProviderId[]) {
      enabled.add(id);
    }
    return enabled;
  }

  for (const token of tokens) {
    if (token === 'tradlinx') {
      enabled.add('tradlinx-schedule');
      continue;
    }
    if (token in publicProviderFactories) {
      enabled.add(token as PublicProviderId);
    }
  }
  return enabled;
}

function parseByokProviderIds(value: string | undefined): Set<ByokProviderId> {
  const enabled = new Set<ByokProviderId>();
  if (!value) return enabled;

  const tokens = value
    .split(/[,\s]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.some((token) => token === '1' || token === 'true' || token === 'all')) {
    for (const id of byokProviderIds) enabled.add(id);
    return enabled;
  }

  for (const token of tokens) {
    if ((byokProviderIds as readonly string[]).includes(token)) {
      enabled.add(token as ByokProviderId);
    }
  }
  return enabled;
}

function hasConfiguredDefaultMarineTrafficProfile(credentialStore: CredentialStore | undefined): boolean {
  return credentialStore?.get(MARINETRAFFIC_DEFAULT_LABEL)?.status === 'configured';
}

export function createRuntimeProviderRegistry(
  env: NodeJS.ProcessEnv = process.env,
  credentialStore?: CredentialStore,
): ProviderRegistry {
  const enabledPublic = parsePublicProviderIds(env[PUBLIC_PROVIDERS_ENV]);
  const enabledByok = parseByokProviderIds(env[BYOK_PROVIDERS_ENV]);
  if (hasConfiguredDefaultMarineTrafficProfile(credentialStore)) {
    enabledByok.add('marinetraffic');
  }
  if (enabledPublic.size === 0 && enabledByok.size === 0) return createProviderRegistry();

  const providers: VesselDataProvider[] = [];
  for (const id of Object.keys(publicProviderFactories) as PublicProviderId[]) {
    if (enabledPublic.has(id)) providers.push(publicProviderFactories[id]());
  }
  if (enabledByok.has('marinetraffic')) {
    if (credentialStore) {
      providers.push(createMarineTrafficProvider({ credentialStore }));
    }
  }
  providers.push(createFixtureProvider());
  return createProviderRegistry(providers);
}
