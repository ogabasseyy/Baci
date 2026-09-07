import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as TypeScript from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';
import { CACHE_LIFE_PROFILES } from '@/config/cache-life-profiles';
import { getFunctionSourceFrom } from './get-function-source-from';

const require = createRequire(import.meta.url);
// The classic compiler API used below is gone from typescript@7 (native
// compiler), so this test pins Microsoft's @typescript/typescript6 compat
// package instead of the workspace `typescript` version.
const ts = require('@typescript/typescript6') as typeof TypeScript;
const CACHED_DATA_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'cached-data.ts'),
  'utf8'
);
const CACHED_DATA_AST = ts.createSourceFile(
  'cached-data.ts',
  CACHED_DATA_SOURCE,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);
const HYDRATE_PUBLIC_PRODUCTS_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'hydrate-public-products.ts'),
  'utf8'
);
const HYDRATE_PUBLIC_PRODUCTS_AST = ts.createSourceFile(
  'hydrate-public-products.ts',
  HYDRATE_PUBLIC_PRODUCTS_SOURCE,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);

function getFunctionSource(functionName: string): string {
  return getFunctionSourceFrom(
    functionName,
    CACHED_DATA_SOURCE,
    CACHED_DATA_AST
  );
}

describe('cached-data cache directives', () => {
  it('keeps hot storefront merchant lookups off the remote cache handler', () => {
    for (const functionName of [
      'getCachedMerchant',
      'getCachedMerchantByDomain',
      'getCachedFeatureSettings',
    ]) {
      const source = getFunctionSource(functionName);
      expect(source, functionName).toContain("'use cache';");
      expect(source, functionName).not.toContain("'use cache: remote';");
    }
  });

  it('keeps the category aggregate wrapper off the remote cache handler', () => {
    const source = getFunctionSource('getCachedCategoryPageData');

    expect(source).not.toContain("'use cache';");
    expect(source).not.toContain("'use cache: remote';");
    expect(source).not.toContain("cacheLife('storefront-page');");

    // The full category payload can include an unbounded product array, so the
    // wrapper must not write that whole aggregate into one remote cache item.
    expect(source).toContain('getCategoryPageShellData');
    expect(source).toContain('getCachedCategoryPageProducts');
  });

  it('keeps category detail chunk reads bounded and inventory-safe', () => {
    const detailsSource = getFunctionSource(
      'getCachedCategoryPageProductDetailsChunk'
    );
    const aggregateSource = getFunctionSource(
      'getCachedCategoryPageProductsUncached'
    );

    expect(CACHED_DATA_SOURCE).toContain('stock_quantity');
    expect(CACHED_DATA_SOURCE).toContain('manage_stock');
    expect(detailsSource).toContain('product_categories.category_id');
    expect(aggregateSource).toContain('mapWithConcurrency');
    expect(aggregateSource).toContain(
      'CATEGORY_PAGE_PRODUCT_DETAIL_CONCURRENCY'
    );
  });

  it('keeps transient category detail query fallbacks outside the cached chunk', () => {
    const cachedDetailsSource = getFunctionSource(
      'getCachedCategoryPageProductDetailsChunk'
    );
    const wrapperSource = getFunctionSource(
      'getCategoryPageProductDetailsChunk'
    );

    expect(cachedDetailsSource).toContain('throw error');
    expect(cachedDetailsSource).not.toContain('productIds.map(() => null)');
    expect(wrapperSource).toContain('Product detail query error:');
    expect(wrapperSource).toContain('productIds.map(() => null)');
  });

  it('keeps serialized inventory availability out of the products cache', () => {
    const hydrateSource = getFunctionSourceFrom(
      'hydrateAndSanitizePublicProducts',
      HYDRATE_PUBLIC_PRODUCTS_SOURCE,
      HYDRATE_PUBLIC_PRODUCTS_AST
    );

    expect(CACHED_DATA_SOURCE).not.toContain(
      'getCachedPublicSerializedVariantSummariesByProductId'
    );
    expect(CACHED_DATA_SOURCE).not.toContain('serialized-variant-summaries');
    expect(hydrateSource).toContain(
      'getPublicSerializedVariantSummariesByProductId'
    );
    expect(hydrateSource).toContain('supabase');
  });

  it('keeps storefront home and launch product caches shared across instances', () => {
    for (const functionName of [
      'getCachedStorefrontHomeProducts',
      'getCachedStorefrontLaunchProducts',
    ]) {
      const source = getFunctionSource(functionName);
      expect(source, functionName).toContain("'use cache: remote';");
    }
  });

  it('keeps high-cardinality public product reads off the remote cache handler', () => {
    for (const functionName of [
      'getCachedProductLcpHint',
      'getCachedProductWithDetails',
    ]) {
      const source = getFunctionSource(functionName);
      expect(source, functionName).toContain("'use cache';");
      expect(source, functionName).not.toContain("'use cache: remote';");
      expect(source, functionName).toContain("cacheLife('products');");
      expect(source, functionName).toContain('cacheTag(');
    }
  });

  it('keeps the unbounded-key canonical redirect preflight off the remote cache handler (PR4a)', () => {
    // Keyed on arbitrary crawler product slugs (unbounded remote keys); origin
    // is an indexed slug/id .maybeSingle() (<15ms). Already fail-loud. The
    // remote SET is the exit-128 write hazard, so it must be local.
    const source = getFunctionSource('getCachedProductCanonicalRedirectTarget');
    expect(source).toContain("'use cache';");
    expect(source).not.toContain("'use cache: remote';");
    expect(source).toContain("cacheLife('products');");
    expect(source).toContain('cacheTag(');
  });

  it('keeps fast merchant-by-id lookups off the remote cache handler and fail-loud (PR4a)', () => {
    // Primary-key .single() (<5ms), ~75 keys, tiny row, no cross-instance need.
    // Fail-loud: a transient read must throw (never cache null-as-absence);
    // only a genuine PGRST116 "no rows" returns null. Both repair-notification
    // consumers already `.catch(() => null)`, so the throw degrades safely.
    const source = getFunctionSource('getCachedMerchantById');
    expect(source).toContain("'use cache';");
    expect(source).not.toContain("'use cache: remote';");
    expect(source).toContain('isPostgrestNoRowsError');
    expect(source).toContain('throw error');
  });

  it('caps the hydrated products payload and keeps it on the shared store (PR4b review r4)', () => {
    // Demotion REVERTED: `revalidateProducts()` busts `products-${merchantId}`
    // on every product create/update/delete, so this entry's freshness depends
    // on tag propagation — which only the SHARED store delivers cross-instance.
    // The row cap (the real exit-128 mitigation) is retained and matters MORE
    // on remote, where an oversized item is what fails the write.
    const source = getFunctionSource('getCachedProducts');
    expect(source).toContain("'use cache: remote';");
    expect(source).toContain("cacheLife('products');");
    expect(source).toContain('cacheTag(');
    expect(source).toContain('GET_CACHED_PRODUCTS_MAX_ROWS');
    expect(CACHED_DATA_SOURCE).toContain('const GET_CACHED_PRODUCTS_MAX_ROWS');
  });

  it('keeps the categories read on the shared store so nav invalidation propagates (PR4b review r4)', () => {
    // Demotion REVERTED: `revalidateCategories()` busts
    // `categories-${merchantId}`; a local entry on another instance would keep
    // serving retired storefront navigation until cacheLife expiry.
    const source = getFunctionSource('getCachedCategories');
    expect(source).toContain("'use cache: remote';");
    expect(source).toContain("cacheLife('categories');");
    expect(source).toContain('cacheTag(');
    expect(source).toContain('throw error');
  });

  it('keeps dashboard stats on the shared store and fail-loud (PR4b review r4)', () => {
    // Demotion REVERTED: `dashboard-${merchantId}` is busted by
    // revalidateProducts(), revalidateMerchant() AND
    // revalidateMerchantPublication(). A merchant who adds a product expects
    // the dashboard to reflect it on whichever instance serves them. Still
    // fail-loud so a transient RPC error is never persisted as null.
    const source = getFunctionSource('getCachedDashboardStats');
    expect(source).toContain("'use cache: remote';");
    expect(source).toContain("cacheLife('merchant');");
    expect(source).toContain('cacheTag(');
    expect(source).toContain('throw error');
  });

  it('keeps platform analytics on the shared store and fail-loud (PR4b review r4)', () => {
    // Demotion REVERTED: the admin "refresh analytics views" route calls
    // revalidateAnalytics(), busting the `analytics` tag — an explicit,
    // user-triggered invalidation contract. A local entry would leave the
    // refresh button silently broken on every other instance. Still fail-loud
    // so a transient aggregate error is never cached as null.
    const source = getFunctionSource('getCachedPlatformAnalytics');
    expect(source).toContain("'use cache: remote';");
    expect(source).toContain("cacheLife('products');");
    expect(source).toContain('cacheTag(');
    expect(source).toContain('throw summaryError');
  });
});

describe('next.config cacheLife profiles', () => {
  it('defines a long-lived `blog` profile so near-static blog pages are not re-rendered every minute', () => {
    const { stale, revalidate, expire } = CACHE_LIFE_PROFILES.blog;
    // Server `revalidate` must be far less frequent than the hot merchant
    // profile (60s) to stop the re-render storm — but bounded (not days):
    // LOCAL Cache Components entries on this profile (e.g. getCachedBlogPost)
    // don't get guaranteed cross-instance tag eviction, so this window also
    // caps edit/delete staleness and missing-slug negative caching (Codex
    // review). Remote entries on the profile (getPublishedClusterPosts) DO
    // get cross-instance tag eviction; for them the window is purely a
    // write-churn bound.
    expect(revalidate).toBeGreaterThanOrEqual(1800); // >= 30 min
    expect(revalidate).toBeLessThanOrEqual(14400); // <= 4 hr
    // Keep client-side staleness short so edited posts surface quickly for
    // visitors who already have the page in their router cache.
    expect(stale).toBeLessThanOrEqual(600);
    expect(expire).toBeGreaterThanOrEqual(revalidate);
  });

  it('keeps product/PDP and compare cache revalidation at least 30 minutes', () => {
    const { stale, revalidate, expire } = CACHE_LIFE_PROFILES.products;
    expect(revalidate).toBeGreaterThanOrEqual(1800);
    expect(revalidate).toBeLessThanOrEqual(3600);
    expect(stale).toBeLessThanOrEqual(600);
    expect(expire).toBeGreaterThan(revalidate);
  });
});
