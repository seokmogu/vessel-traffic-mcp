import { createFixtureProvider } from './fixture.js';
import type { VesselDataProvider } from './types.js';

export interface ProviderRegistry {
  providers(): VesselDataProvider[];
}

export function createProviderRegistry(providers: VesselDataProvider[] = [createFixtureProvider()]): ProviderRegistry {
  return {
    providers() {
      return [...providers];
    },
  };
}
