import { getHostedStorefrontConfiguration } from './hosted-storefront-configuration';
import { hostedStorefrontRuntime } from './hosted-storefront-runtime';
import { getLocalStorefrontStoragePrefix } from './local-storefront-storage-prefix';

export function getStorefrontStoragePrefix(
  mode: unknown = process.env.EXPO_PUBLIC_HOSTED_STOREFRONT,
  profile?: unknown,
  trustedConfiguration?: { supabaseOrigins: readonly string[] },
  development = typeof __DEV__ !== 'undefined' && __DEV__
): string {
  if (mode === undefined || mode === '' || mode === '0')
    return getLocalStorefrontStoragePrefix();
  if (mode !== '1') throw new Error('Invalid hosted storage mode');
  if (profile === undefined && trustedConfiguration === undefined) {
    if (!development) throw new Error('Hosted storefront is development-only');
    const runtime = hostedStorefrontRuntime.read();
    if (!runtime) throw new Error('Verified hosted runtime is required');
    return runtime.storagePrefix;
  }
  return getHostedStorefrontConfiguration(
    profile,
    development,
    trustedConfiguration
  ).storagePrefix;
}
