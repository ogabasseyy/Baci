import { createOxygenStagingFetch } from './oxygen-staging-fetch';
import type { OxygenStagingProfile } from './oxygen-staging-profile';
import { readOxygenStagingProfile } from './oxygen-staging-profile';

type Runtime = {
  fetch: typeof fetch;
  __baciOxygenStagingRuntime?: {
    profile: OxygenStagingProfile;
    identity: string;
  };
};

// Called synchronously from index, before Supabase/order/store modules load.
export function installOxygenStagingRuntime(
  profile: OxygenStagingProfile,
  runtime: Runtime = globalThis,
  development = typeof __DEV__ !== 'undefined' && __DEV__
): void {
  const verified = readOxygenStagingProfile(profile, development);
  const identity = JSON.stringify(verified);
  if (runtime.__baciOxygenStagingRuntime) {
    if (runtime.__baciOxygenStagingRuntime.identity !== identity)
      throw new Error('Fully reload before changing Oxygen staging profiles');
    return;
  }
  runtime.fetch = createOxygenStagingFetch(
    runtime.fetch.bind(runtime),
    verified
  );
  runtime.__baciOxygenStagingRuntime = { profile: verified, identity };
}
