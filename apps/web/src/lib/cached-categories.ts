import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cacheLife, cacheTag } from 'next/cache';
import { cache } from 'react';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';
import { createPriorityStorefrontReadFetch } from './storefront-public-read-fetch';

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
      // Priority lane, not the shared build semaphore: nav must resolve
      // inside the prerender window (see createPriorityStorefrontReadFetch).
      fetch: createPriorityStorefrontReadFetch(),
    },
  });
}

/**
 * Exact priority order - matches "Shop by Category" dropdown in the Navbar.
 * Categories are matched by checking if their name STARTS with these keywords.
 */
const NAVIGATION_CATEGORY_PRIORITY_ORDER = [
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

function getNavigationCategoryPriorityIndex(name: string): number {
  const lowerName = name.toLowerCase();
  // First try exact match or starts-with match (more specific)
  for (let i = 0; i < NAVIGATION_CATEGORY_PRIORITY_ORDER.length; i++) {
    if (
      lowerName === NAVIGATION_CATEGORY_PRIORITY_ORDER[i] ||
      lowerName.startsWith(NAVIGATION_CATEGORY_PRIORITY_ORDER[i])
    ) {
      return i;
    }
  }
  // Fallback: check if name contains the keyword (less specific)
  for (let i = 0; i < NAVIGATION_CATEGORY_PRIORITY_ORDER.length; i++) {
    if (lowerName.includes(NAVIGATION_CATEGORY_PRIORITY_ORDER[i])) {
      return i;
    }
  }
  return -1; // Not found
}

function sortNavigationCategories(
  categories: CategoryNavItem[]
): CategoryNavItem[] {
  return categories.sort((a: CategoryNavItem, b: CategoryNavItem) => {
    const aIndex = getNavigationCategoryPriorityIndex(a.name);
    const bIndex = getNavigationCategoryPriorityIndex(b.name);

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
 * Raw top-level category read with NO cache directives. Runs the same indexed
 * parent_id-null query as the cached fill below, but stays callable after a
 * prerender has ended (plain tasky fetch — no cache scope to reject it).
 * Used as the last-resort fallback in getStorefrontNavigationCategories when
 * the cache scope itself is unavailable; never call it directly from pages.
 */
async function fetchNavigationCategoriesUncached(
  merchantId: string
): Promise<CategoryNavItem[]> {
  const supabase = getPublicSupabaseClient();

  const { data, error } = await supabase
    .from('categories')
    .select('name, slug')
    .eq('merchant_id', merchantId)
    .is('parent_id', null) // Only top-level categories
    .order('name');

  if (error) {
    // A fetch issued after its prerender tore down is expected build-time
    // contention, never a data failure: rethrow quietly (the boundary below
    // recognizes it) so one aborted page doesn't cost a log line.
    if (!isPrerenderOverRejection(error)) {
      console.error('Failed to fetch navigation categories:', error);
    }
    throw error;
  }

  return sortNavigationCategories(data || []);
}

/**
 * Fetch top-level categories for navigation (server-side cached)
 * Uses unstable_cache for cross-request caching with 5-minute TTL
 * Should be called from server components with ISR
 */
export function getCachedNavigationCategories(
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

  // Fail loud on purpose: a transient read must never be persisted as an
  // empty nav. The boundary below catches this OUTSIDE the cache scope.
  return fetchNavigationCategoriesUncached(merchantId);
}

/**
 * Matches the rejection Next.js raises when a `'use cache'` read lands after
 * its prerender has already ended (digest HANGING_PROMISE_REJECTION). By
 * design that rejection protects the cache from post-abort fills — it says
 * nothing about the underlying data, so the boundary below answers it with a
 * direct uncached read instead of an empty nav.
 */
function isPrerenderEndedRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const digest = (error as { digest?: unknown }).digest;
  if (digest === 'HANGING_PROMISE_REJECTION') {
    return true;
  }

  const message = (error as { message?: unknown }).message;
  return (
    typeof message === 'string' &&
    message.includes('called after prerender ended')
  );
}

/**
 * Matches the rejection Next.js raises when a fetch is ISSUED after its
 * prerender already ended (as opposed to the cache-scope guard above). The
 * prerender is over, so retrying is futile — the boundary answers with a
 * quiet empty nav and the request-time retry fills the real one.
 */
function isPrerenderOverRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const message = (error as { message?: unknown }).message;
  return (
    typeof message === 'string' &&
    message.includes('fetch() rejects when the prerender is complete')
  );
}

/**
 * Request-local fail-open boundary for the storefront shell navigation.
 *
 * The nav dropdown is optional enrichment: a transient category read must not
 * turn an otherwise-renderable page into a 500. The cached fill above stays
 * fail-loud (so a transient failure is never persisted as an empty nav); this
 * uncached boundary catches that throw OUTSIDE the Cache Components scope and
 * degrades to an empty nav for the current request only, so the next request
 * retries against the origin. When the throw is only the prerender-ended
 * guard (cache scope gone, data fine), the boundary serves one direct
 * uncached read so prerendered pages keep their real nav instead of an empty
 * one. Consumers (storefront shell, ogabassey home) must call this wrapper,
 * never the cached fill directly.
 */
export const getStorefrontNavigationCategories = cache(
  async (merchantId: string): Promise<CategoryNavItem[]> => {
    try {
      return await getCachedNavigationCategories(merchantId);
    } catch (error) {
      // The prerender itself is over: a retry would fail the same way.
      // Quiet empty nav — the request-time retry fills the real one.
      if (isPrerenderOverRejection(error)) {
        return [];
      }

      if (isPrerenderEndedRejection(error)) {
        try {
          return await fetchNavigationCategoriesUncached(merchantId);
        } catch (retryError) {
          // The teardown won the race even on the priority lane. Expected
          // build-time degradation: stay silent, the request-time retry
          // fills the real nav.
          if (
            isPrerenderEndedRejection(retryError) ||
            isPrerenderOverRejection(retryError)
          ) {
            return [];
          }
          // Direct read failed too — fall through to the empty nav below.
        }
      }

      console.error('Navigation categories query failed outside cache:', {
        merchantId,
        error,
      });
      return [];
    }
  }
);
