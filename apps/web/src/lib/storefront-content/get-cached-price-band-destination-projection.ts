import { cacheLife, cacheTag } from 'next/cache';
import { createStorefrontReadDeadline } from '@/lib/create-storefront-read-deadline';
import { prepareStorefrontSingleAttemptQuery } from '@/lib/prepare-storefront-single-attempt-query';
import { getPublicSupabaseClient } from '@/lib/public-supabase-client';
import { getCachedCompareCategoryShell } from '@/lib/storefront-compare/get-cached-compare-category-shell';
import { COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT } from '@/lib/storefront-compare/price-band-taxonomy';

export interface PriceBandDestinationProduct {
  id?: string | null;
  slug: string;
  name: string;
  brand: string | null;
  price: number;
  stock?: number | null;
  stock_quantity?: number | null;
  manage_stock?: boolean | null;
  has_condition_offers?: boolean | null;
}

const PRODUCT_LIMIT = COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT;
const SELECT =
  'id, slug, name, brand, price, stock, stock_quantity, manage_stock, has_condition_offers';

function toProduct(value: unknown): PriceBandDestinationProduct | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const slug = (row.slug as string) || (row.id as string);
  const rawPrice = row.price;
  const price =
    typeof rawPrice === 'number'
      ? rawPrice
      : typeof rawPrice === 'string' && rawPrice.trim()
        ? Number(rawPrice.replace(/,/g, '').trim())
        : Number.NaN;
  if (
    typeof slug !== 'string' ||
    typeof row.name !== 'string' ||
    !Number.isFinite(price)
  )
    return null;
  return {
    id: typeof row.id === 'string' ? row.id : undefined,
    slug,
    name: row.name,
    brand: typeof row.brand === 'string' ? row.brand : null,
    price,
    stock:
      typeof row.stock === 'number'
        ? row.stock
        : typeof row.stock === 'string'
          ? Number(row.stock)
          : null,
    stock_quantity:
      typeof row.stock_quantity === 'number'
        ? row.stock_quantity
        : typeof row.stock_quantity === 'string'
          ? Number(row.stock_quantity)
          : null,
    manage_stock:
      typeof row.manage_stock === 'boolean' ? row.manage_stock : null,
    has_condition_offers:
      typeof row.has_condition_offers === 'boolean'
        ? row.has_condition_offers
        : null,
  };
}

/**
 * Bounded destination window proof for optional links, not a display catalogue.
 * Reuses destination category/children and legacy membership, counts all active
 * rows (including unavailable stock), and never fetches rich detail chunks.
 * Truncated or malformed pools suppress links rather than certify a partial
 * window. Comparing rows.length against Math.min(count, PRODUCT_LIMIT) detects
 * server-side row truncation while allowing categories larger than 150 items.
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
          .limit(PRODUCT_LIMIT),
        deadline.signal
      ),
      deadline.promise,
    ]);
    if (error) throw error;
    const rows: unknown[] = data ?? [];
    if (count === null || rows.length !== Math.min(count, PRODUCT_LIMIT))
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
