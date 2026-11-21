/**
 * React Query Client Configuration with Async Persistence
 *
 * 2026 Best Practice: "Flash-Load" Pattern
 * - Data displayed from cache within 50ms on app start
 * - Background refresh happens after cached data is shown
 * - 24-hour cache retention for offline resilience
 *
 * Reliability note (Android startup):
 * - We intentionally use AsyncStorage (async) instead of MMKV (sync) here
 *   for query persistence.
 * - Some Android users reported startup hangs on the animated splash screen.
 * - Sync storage hydration can block the JS thread during app bootstrap.
 * - Cache restore/subscription is also deferred until after splash exit in
 *   `QueryProvider` to keep startup work off the critical render path.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { oxygenStagingStorageKey } from './oxygen-staging-profile';

export const QUERY_CACHE_STORAGE_KEY = 'REACT_QUERY_OFFLINE_CACHE';

/**
 * AsyncStorage-based Persister (startup-safe)
 * Uses async storage to avoid synchronous JS-thread stalls during startup.
 */
export const queryPersister = createAsyncStoragePersister({
  key: oxygenStagingStorageKey(QUERY_CACHE_STORAGE_KEY),
  storage: AsyncStorage,
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Stale-while-revalidate: Show cached data immediately, refresh in background
      staleTime: 1000 * 60 * 5, // 5 minutes - data considered fresh
      gcTime: 1000 * 60 * 60 * 24, // 24 hours - keep in cache for offline access

      // Retry failed requests with exponential backoff
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),

      // Mobile-optimized refetch behaviors
      refetchOnWindowFocus: false, // Mobile doesn't have window focus
      refetchOnMount: true, // Refresh on screen mount
      refetchOnReconnect: true, // Refresh when network returns

      // Network mode for offline support
      networkMode: 'offlineFirst', // Use cache first, then network
    },
    mutations: {
      // Mutations should wait for network
      networkMode: 'online',
    },
  },
});

// Export cache key constants for consistency
export const QUERY_CACHE_KEYS = {
  products: 'products',
  product: (slug: string) => ['product', slug],
  categories: 'categories',
  wallet: 'wallet',
  orders: 'orders',
  pageConfig: (page: string) => ['pageConfig', page],
} as const;
