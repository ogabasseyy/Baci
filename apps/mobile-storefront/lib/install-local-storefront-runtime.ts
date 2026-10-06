import Constants from 'expo-constants';
import { createLocalStorefrontFetch } from './create-local-storefront-fetch';
import { getLocalStorefrontStoragePrefix } from './local-storefront-storage-prefix';

type LocalRuntimeGlobal = typeof globalThis & {
  __baciLocalStorefrontTransport?: { identity: string };
};

export function installLocalStorefrontRuntime(): void {
  if (!getLocalStorefrontStoragePrefix())
    throw new Error('Local runtime requires explicit local mode');
  const apiOrigin = process.env.EXPO_PUBLIC_API_URL ?? '';
  const supabaseOrigin = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const token = process.env.EXPO_PUBLIC_LOCAL_STOREFRONT_TOKEN ?? '';
  const expectedAuthIssuer = process.env.EXPO_PUBLIC_LOCAL_AUTH_ISSUER ?? '';
  const extra = Constants.expoConfig?.extra;
  if (
    extra?.localStorefront !== true ||
    extra.localAuthIssuer !== expectedAuthIssuer ||
    extra.apiUrl !== apiOrigin ||
    extra.supabaseUrl !== supabaseOrigin ||
    extra.supabaseAnonKey !== anonKey ||
    extra.supabasePublishableKey !== anonKey ||
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY !== anonKey ||
    extra.merchantId !== process.env.EXPO_PUBLIC_MERCHANT_ID ||
    extra.posthogApiKey ||
    extra.facebookAppId ||
    extra.facebookClientToken ||
    extra.tiktokBusiness?.isConfigured ||
    extra.eas?.projectId ||
    Constants.expoConfig?.updates?.enabled !== false ||
    process.env.EXPO_PUBLIC_SENTRY_DSN
  )
    throw new Error(
      'Local storefront requires a fresh sanitized local Expo manifest'
    );
  const runtime = globalThis as LocalRuntimeGlobal;
  const identity = `${apiOrigin}|${supabaseOrigin}|${expectedAuthIssuer}|${token}`;
  if (runtime.__baciLocalStorefrontTransport) {
    if (runtime.__baciLocalStorefrontTransport.identity !== identity)
      throw new Error(
        'Fully reload the app before changing local environments'
      );
    return;
  }
  runtime.fetch = createLocalStorefrontFetch(runtime.fetch.bind(runtime), {
    apiOrigin,
    supabaseOrigin,
    token,
    anonKey,
    expectedAuthIssuer,
  });
  runtime.__baciLocalStorefrontTransport = { identity };
}
