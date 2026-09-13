import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cacheLife, cacheTag } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { cache } from 'react';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';
import { createStorefrontPublicReadFetch } from './storefront-public-read-fetch';

export interface CategoryNavItem {
  name: string;
  slug: string;
}

/**
 * Create a Supabase client for cached queries.
 * This client doesn't use cookies, so it's suitable for caching.
 */
function getPublicSupabaseClient() {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();

  if (!url || !key) {
    throw new Error('Supabase configuration is missing');
  }

  return createSupabaseClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: createStorefrontPublicReadFetch(),
    },
  });
}

/**
 * Fetch top-level categories for navigation (server-side cached)
 * Uses unstable_cache for cross-request caching with 5-minute TTL
 * Should be called from server components with ISR
 */
export async function getCachedNavigationCategories(
  merchantId: string
): Promise<CategoryNavItem[]> {
  // PR4a: local `'use cache'`, not the framework remote handler. Top-level
  // {name,slug} rows (~19, <2KB) via an indexed parent_id-null read (<10ms) —
  // no cross-instance sharing need, and the coarse remote SET is the exit-128
  // write hazard. A bounded `categories` life caps cross-instance staleness,
  // and the merchant-scoped tag rides alongside the coarse tags that
  // revalidateCategories() already busts.
  'use cache';
  cacheLife('categories');
  cacheTag(
    'categories',
    'navigation-categories',
    `navigation-categories-${merchantId}`
  );

  const supabase = getPublicSupabaseClient();

  const { data, error } = await supabase
    .from('categories')
    .select('name, slug')
    .eq('merchant_id', merchantId)
    .is('parent_id', null) // Only top-level categories
    .order('name');

  if (error) {
    // Fail loud: a transient nav read must never be persisted as an empty nav.
    // The request-local getStorefrontNavigationCategories boundary below
    // catches this OUTSIDE the cache scope so the page still renders.
    console.error('Failed to fetch navigation categories:', error);
    throw error;
  }

  const categories = data || [];

  // Exact priority order - matches "Shop by Category" dropdown in the Navbar
  // Categories are matched by checking if their name STARTS with these keywords
  const PRIORITY_ORDER = [
    'smartphones',
    'laptops',
    'tablets',
    'gaming',
    'wearables',
    'audio',
    'smart tvs',
    'monitors',
    'printers',
    'accessories',
    'desktops',
    'general',
  ];

  // Helper: find the best matching priority index for a category name
  const getPriorityIndex = (name: string): number => {
    const lowerName = name.toLowerCase();
    // First try exact match or starts-with match (more specific)
    for (let i = 0; i < PRIORITY_ORDER.length; i++) {
      if (
        lowerName === PRIORITY_ORDER[i] ||
        lowerName.startsWith(PRIORITY_ORDER[i])
      ) {
        return i;
      }
    }
    // Fallback: check if name contains the keyword (less specific)
    for (let i = 0; i < PRIORITY_ORDER.length; i++) {
      if (lowerName.includes(PRIORITY_ORDER[i])) {
        return i;
      }
    }
    return -1; // Not found
  };

  return categories.sort((a: CategoryNavItem, b: CategoryNavItem) => {
    const aIndex = getPriorityIndex(a.name);
    const bIndex = getPriorityIndex(b.name);

    // Both are priority categories -> sort by priority index
    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }

    // Only A is priority -> A comes first
    if (aIndex !== -1) return -1;

    // Only B is priority -> B comes first
    if (bIndex !== -1) return 1;

    // Neither is priority -> Alphabetical sort
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

/**
 * Request-local fail-open boundary for the storefront shell navigation.
 *
 * The nav dropdown is optional enrichment: a transient category read must not
 * turn an otherwise-renderable page into a 500. The cached fill above stays
 * fail-loud (so a transient failure is never persisted as an empty nav); this
 * uncached boundary catches that throw OUTSIDE the Cache Components scope and
 * degrades to an empty nav for the current request only, so the next request
 * retries against the origin. Consumers (storefront shell, ogabassey home)
 * must call this wrapper, never the cached fill directly.
 */
export const getStorefrontNavigationCategories = cache(
  async (merchantId: string): Promise<CategoryNavItem[]> => {
    try {
      return await getCachedNavigationCategories(merchantId);
    } catch (error) {
      unstable_rethrow(error);
      console.error('Navigation categories query failed outside cache:', {
        merchantId,
        error,
      });
      return [];
    }
  }
);
