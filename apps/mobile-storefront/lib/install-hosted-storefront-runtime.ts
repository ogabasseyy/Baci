import type { SupportedStorage } from '@supabase/supabase-js';
import { getDefaultSupabaseAuthStorageKey } from './auth/supabase-auth-storage-key';
import { getHostedStorefrontConfiguration } from './hosted-storefront-configuration';
import { createHostedStorefrontFetch } from './hosted-storefront-fetch';
import { createHostedStorefrontSessionStorage } from './hosted-storefront-session-storage';

type VerifiedProfile = Readonly<{
  mode: 'hosted-staging';
  apiOrigin: string;
  supabaseOrigin: string;
  expectedAuthIssuer: string;
  merchantId: string;
  publicKey: string;
}>;

type ClientOptions = {
  auth: {
    storage: SupportedStorage;
    storageKey: string;
    autoRefreshToken: true;
    persistSession: true;
    detectSessionInUrl: false;
    flowType: 'pkce';
  };
  global: { fetch: typeof fetch };
};

export async function installHostedStorefrontRuntime<Client>(
  requestedProfile: unknown,
  requestedPublicKey: string,
  dependencies: {
    development?: boolean;
    transport: typeof fetch;
    storage: SupportedStorage;
    trusted: {
      publicKey: string;
      expectedAuthIssuer: string;
      verifyProfile: (profile: VerifiedProfile) => Promise<boolean>;
    };
    createClient: (url: string, key: string, options: ClientOptions) => Client;
  }
) {
  const development =
    dependencies.development ?? (typeof __DEV__ !== 'undefined' && __DEV__);
  let configuration: ReturnType<typeof getHostedStorefrontConfiguration>;
  let guardedFetch: typeof fetch;
  let storage: SupportedStorage;
  let publicKey: string;
  try {
    const trusted = Object.freeze({
      supabaseOrigins: Object.freeze(['https://staging-auth.ogabassey.com']),
      publicKey: dependencies.trusted.publicKey,
    });
    configuration = getHostedStorefrontConfiguration(
      requestedProfile,
      development,
      trusted
    );
    publicKey = trusted.publicKey;
    if (
      publicKey !== requestedPublicKey ||
      configuration.expectedAuthIssuer !==
        dependencies.trusted.expectedAuthIssuer ||
      typeof dependencies.trusted.verifyProfile !== 'function'
    )
      throw new Error();
    const profile = Object.freeze({
      mode: configuration.mode,
      apiOrigin: configuration.apiOrigin,
      supabaseOrigin: configuration.supabaseOrigin,
      expectedAuthIssuer: configuration.expectedAuthIssuer,
      merchantId: configuration.merchantId,
    });
    guardedFetch = createHostedStorefrontFetch(
      dependencies.transport,
      profile,
      trusted,
      development
    );
    storage = createHostedStorefrontSessionStorage(
      dependencies.storage,
      profile,
      trusted,
      development
    );
    if (
      (await dependencies.trusted.verifyProfile(
        Object.freeze({ ...profile, publicKey })
      )) !== true
    )
      throw new Error();
  } catch {
    throw new Error('Hosted staging profile verification failed');
  }
  const supabase = dependencies.createClient(
    configuration.supabaseOrigin,
    publicKey,
    {
      auth: {
        storage,
        storageKey: getDefaultSupabaseAuthStorageKey(
          configuration.supabaseOrigin
        ),
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
      global: { fetch: guardedFetch },
    }
  );
  return Object.freeze({
    supabase,
    supabaseOrigin: configuration.supabaseOrigin,
    publicKey,
    authStorage: storage,
    authStorageKey: getDefaultSupabaseAuthStorageKey(
      configuration.supabaseOrigin
    ),
    fetch: guardedFetch,
    apiOrigin: configuration.apiOrigin,
    merchantId: configuration.merchantId,
    storagePrefix: configuration.storagePrefix,
    financialActivationEnabled: false as const,
    telemetryEnabled: false as const,
    requiresFullReload: true as const,
  });
}
