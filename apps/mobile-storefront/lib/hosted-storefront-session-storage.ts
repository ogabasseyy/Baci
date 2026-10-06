import type { SupportedStorage } from '@supabase/supabase-js';
import { getHostedStorefrontConfiguration } from './hosted-storefront-configuration';

export function createHostedStorefrontSessionStorage(
  storage: SupportedStorage,
  profile: unknown,
  trustedConfiguration: { supabaseOrigins: readonly string[] },
  development = typeof __DEV__ !== 'undefined' && __DEV__
): SupportedStorage {
  const prefix = getHostedStorefrontConfiguration(
    profile,
    development,
    trustedConfiguration
  ).storagePrefix;
  return Object.freeze({
    getItem: (key: string) => storage.getItem(`${prefix}${key}`),
    setItem: (key: string, value: string) =>
      storage.setItem(`${prefix}${key}`, value),
    removeItem: (key: string) => storage.removeItem(`${prefix}${key}`),
  });
}
