import { CHECKOUT_INSTALLATION_STORAGE_KEY } from '@/config/checkout-storage';
import { getClearableCacheStorageKeys } from './clear-cache-keys';

it('preserves pending checkout recovery identity when clearing cache', () => {
  expect(
    getClearableCacheStorageKeys([CHECKOUT_INSTALLATION_STORAGE_KEY])
  ).not.toContain(CHECKOUT_INSTALLATION_STORAGE_KEY);
});

describe('getClearableCacheStorageKeys', () => {
  it('keeps cache keys visible from MMKV and legacy storage', () => {
    expect(
      getClearableCacheStorageKeys([
        'REACT_QUERY_OFFLINE_CACHE',
        'cache:product-list',
        'image-cache:hero',
        'product-cache:featured',
        'legacy-product-results',
        'recent-products-cache',
      ])
    ).toEqual([
      'REACT_QUERY_OFFLINE_CACHE',
      'cache:product-list',
      'image-cache:hero',
      'product-cache:featured',
      'legacy-product-results',
      'recent-products-cache',
    ]);
  });

  it('preserves durable user state while adding the query cache key', () => {
    expect(
      getClearableCacheStorageKeys([
        'cart-storage',
        'comparison-storage',
        'saved-storage',
        'search_history',
        'supabase.auth.token',
        'app-settings-storage',
        'app-theme-storage',
        'auth-storage',
        'baci:savings-reminder-goal-id',
        '@baci_storefront_push_token',
        '@baci_storefront_push_opt_out_user-id',
        'baci_offline_mutation_queue',
        'permission-booster-storage',
      ])
    ).toEqual(['REACT_QUERY_OFFLINE_CACHE']);
  });
});
