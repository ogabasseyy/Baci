import { CHECKOUT_INSTALLATION_STORAGE_KEY } from '@/config/checkout-storage';
import { QUERY_CACHE_STORAGE_KEY } from '@/lib/query-client';

const CLEAR_CACHE_PRESERVED_KEYS = new Set([
  CHECKOUT_INSTALLATION_STORAGE_KEY,
  'app-settings-storage',
  'app-theme-storage',
  'auth-storage',
  'cart-storage',
  'comparison-storage',
  'saved-storage',
  'search_history',
  '@baci_storefront_push_token',
  'baci_offline_mutation_queue',
  'permission-booster-storage',
]);

const CLEAR_CACHE_PRESERVED_PREFIXES = [
  'supabase',
  'baci:savings-reminder-',
  '@baci_storefront_push_opt_out_',
] as const;

function isClearableCacheStorageKey(key: string): boolean {
  if (CLEAR_CACHE_PRESERVED_KEYS.has(key)) {
    return false;
  }

  if (CLEAR_CACHE_PRESERVED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return false;
  }

  return true;
}

export function getClearableCacheStorageKeys(
  storageKeys: Iterable<string>
): string[] {
  const keys = new Set(storageKeys);
  keys.add(QUERY_CACHE_STORAGE_KEY);
  return Array.from(keys).filter(isClearableCacheStorageKey);
}
