import { cacheLife, cacheTag } from 'next/cache';
import { createStorefrontReadDeadline } from '@/lib/create-storefront-read-deadline';
import { prepareStorefrontSingleAttemptQuery } from '@/lib/prepare-storefront-single-attempt-query';
import { getPublicSupabaseClient } from '@/lib/public-supabase-client';
import { getCachedCompareCategoryShell } from '@/lib/storefront-compare/get-cached-compare-category-shell';

export interface PriceBandDestinationProduct {
  slug: string;
  name: string;
  brand: string | null;
  price: number;
}

const PRODUCT_LIMIT = 600;
const SELECT = 'id, slug, name, brand, price';

function toProduct(value: unknown): PriceBandDestinationProduct | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const slug = row.slug || row.id;
  // Match the destination's JS numeric comparisons; do not reinterpret
  // grouped strings (which its normalizeProduct path leaves non-numeric).
  const price =
    typeof row.price === 'number' || typeof row.price === 'string'
      ? Number(row.price)
      : Number.NaN;
  if (
    typeof slug !== 'string' ||
    typeof row.name !== 'string' ||
    !Number.isFinite(price)
  )
    return null;
  return {
    slug,
    name: row.name,
    brand: typeof row.brand === 'string' ? row.brand : null,
    price,
  };
}

/**
 * Small complete-catalogue proof for optional links, not a display catalogue.
 * Reuses destination category/children and legacy membership, counts all active
 * rows (including unavailable stock), and never fetches rich detail chunks.
 * Over-cap, truncated or malformed pools suppress links rather than certify a
 * partial catalogue. The exact count also detects server-side row truncation.
 */
export async function getCachedPriceBandDestinationProjection(
  merchantId: string,
  categorySlug: string
): Promise<PriceBandDestinationProduct[] | null> {
  'use cache';
  cacheLife('products');
  cacheTag(
    'products',
    'categories',
    `products-${merchantId}`,
    `categories-${merchantId}`
  );
  const deadline = createStorefrontReadDeadline(3000);
  try {
    const shell = await Promise.race([
      getCachedCompareCategoryShell(merchantId, categorySlug),
      deadline.promise,
    ]);
    const scope = shell.productScope;
    if (shell.isCollection || scope.kind === 'collection') return null;
    if (scope.kind === 'none') return [];
    deadline.signal.throwIfAborted();
    let query = getPublicSupabaseClient()
      .from('products')
      .select(
        scope.kind === 'category'
          ? `${SELECT}, product_categories!inner(category_id)`
          : SELECT,
        { count: 'exact' }
      )
      .eq('merchant_id', merchantId)
      .eq('status', 'active');
    if (scope.kind === 'category') {
      query = query.in('product_categories.category_id', scope.categoryIds);
    } else {
      const name = scope.categoryName.replace(/[,().]/g, '');
      query = query.or(
        `category.ilike.%${name}%,brand.ilike.%${name}%,name.ilike.%${name}%`
      );
    }
    const { data, count, error } = await Promise.race([
      prepareStorefrontSingleAttemptQuery(
        query
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .limit(PRODUCT_LIMIT + 1),
        deadline.signal
      ),
      deadline.promise,
    ]);
    if (error) throw error;
    const rows: unknown[] = data ?? [];
    if (count === null || count > PRODUCT_LIMIT || count !== rows.length)
      return null;
    const products = rows.map(toProduct);
    if (products.some((product) => product === null)) return null;
    return products.filter(
      (product): product is PriceBandDestinationProduct => product !== null
    );
  } finally {
    deadline.cleanup();
  }
}
