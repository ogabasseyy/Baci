import type { QueryClient } from '@tanstack/react-query';
import { withSupabaseRetry } from '@/lib/api';
import { CONFIG } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { normalizeVariantAttributes } from '@/lib/product-normalization';
import { removeProductSlugFromProductsCache } from '@/lib/product-query-cache';
import { getProductSlugFallbackCandidates } from '@/lib/product-slug-fallback';
import { supabase } from '@/lib/supabase';
import {
  hydrateRowsNeedingBaseInventory,
  hydrateRowsNeedingConditionOffers,
  hydrateRowsNeedingStorefrontVariants,
} from './product-hydration';
import { PRODUCT_DETAIL_SELECT } from './product-select';

export { fetchAvailableBrands } from './product-brands';
export { fetchProductsPage } from './product-pages';
export { PRODUCT_DETAIL_SELECT, PRODUCT_SELECT } from './product-select';
export {
  normalizeProductVariants,
  transformProduct,
} from './product-transform';
export type {
  Category,
  ProductsPage,
  UseProductsOptions,
} from './product-utils.types';

const log = createLogger('Products');

export const MERCHANT_SLUG = CONFIG.MERCHANT_SLUG || 'ogabassey';
export const CONSTANT_MERCHANT_ID = CONFIG.MERCHANT_ID;
export const PRODUCT_QUERY_VERSION = 'variant-media-v2';

export function buildProductQueryKey(slug: string, merchantId: string) {
  return ['product', PRODUCT_QUERY_VERSION, slug, merchantId] as const;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function fetchProductRow(
  merchantId: string,
  identifier: string,
  context: string
) {
  let supabaseQuery = supabase
    .from('products')
    .select(PRODUCT_DETAIL_SELECT)
    .eq('merchant_id', merchantId)
    .eq('status', 'active');

  supabaseQuery = isUuid(identifier)
    ? supabaseQuery.eq('id', identifier)
    : supabaseQuery.eq('slug', identifier);

  return withSupabaseRetry(async () => await supabaseQuery.maybeSingle(), {
    maxRetries: 3,
    onRetry: (attempt, err) => {
      log.warn(`${context} retry ${attempt}: ${err.message}`);
    },
  });
}

export async function resolveProductRow(merchantId: string, slug: string) {
  const exact = await fetchProductRow(merchantId, slug, 'Product');
  if (exact.error) throw exact.error;
  if (exact.data) {
    const [hydratedProduct] = await hydrateRowsNeedingConditionOffers(
      await hydrateRowsNeedingBaseInventory(
        await hydrateRowsNeedingStorefrontVariants([exact.data])
      )
    );
    return hydratedProduct ?? exact.data;
  }
  if (isUuid(slug)) return null;

  for (const fallbackSlug of getProductSlugFallbackCandidates(slug)) {
    const fallback = await fetchProductRow(
      merchantId,
      fallbackSlug,
      'Product fallback'
    );
    if (fallback.error) throw fallback.error;
    if (fallback.data) {
      const [hydratedFallback] = await hydrateRowsNeedingConditionOffers(
        await hydrateRowsNeedingBaseInventory(
          await hydrateRowsNeedingStorefrontVariants([fallback.data])
        )
      );
      log.warn(`Resolved legacy product slug "${slug}" to "${fallbackSlug}"`);
      return hydratedFallback ?? fallback.data;
    }
  }

  return null;
}

export async function resolveAndEvictProduct(
  merchantId: string,
  slug: string,
  queryClient: QueryClient
) {
  const data = await resolveProductRow(merchantId, slug);
  if (data) return data;

  queryClient.removeQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return (
        Array.isArray(key) &&
        key[0] === 'product' &&
        key[key.length - 2] === slug &&
        key[key.length - 1] === merchantId
      );
    },
  });

  queryClient.setQueriesData(
    { queryKey: ['products', merchantId], exact: false },
    (cached) => removeProductSlugFromProductsCache(cached, slug)
  );

  throw new Error(
    'This product is no longer available. Refresh the app to remove outdated product cards.'
  );
}

export { log, normalizeVariantAttributes };
