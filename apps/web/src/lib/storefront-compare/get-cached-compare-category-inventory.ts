import { cacheLife, cacheTag } from 'next/cache';
import { PRODUCT_KEY_SPECS_RELATION_SELECT } from '@/lib/product-key-specs-select';
import { getPublicSupabaseClient } from '@/lib/public-supabase-client';
import { generateSlug } from '@/lib/seo-utils';
import type { ComparableProductKeySpecs } from '@/lib/storefront-specs/spec-taxonomy';
import { extractComparableKeySpecs } from './comparable-key-specs';
import { getCachedCompareCategoryShell } from './get-cached-compare-category-shell';

export interface CompareCategoryInventoryProduct {
  slug: string;
  name: string;
  brand: string | null;
  price: number;
  category_slug: string;
  status: string;
  product_key_specs: ComparableProductKeySpecs | null;
}

export interface CompareCategoryInventory {
  isCollection: boolean;
  fallbackName: string;
  products: CompareCategoryInventoryProduct[];
}

// Hard row bound so this entry stays far below Vercel's per-item data-cache
// byte limit even with the key-specs relation attached (~1.7KB/row observed →
// 600 rows ≈ 1MB). Compare URLs for products beyond the newest 600 in a
// category degrade to the not-found path instead of breaking the cache entry
// for the whole category.
export const COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT = 600;

const COMPARE_CATEGORY_INVENTORY_SELECT = `
  id,
  slug,
  name,
  brand,
  price,
  category,
  ${PRODUCT_KEY_SPECS_RELATION_SELECT}
`;

interface CompareCategoryInventoryCategoryJoin {
  categories?:
    | { slug?: string | null }
    | Array<{ slug?: string | null }>
    | null;
}

interface CompareCategoryInventoryRow {
  brand?: string | null;
  category?: string | null;
  id?: string | null;
  name?: string | null;
  price?: number | string | null;
  product_categories?: CompareCategoryInventoryCategoryJoin[] | null;
  product_key_specs?: unknown;
  slug?: string | null;
}

/**
 * Mirrors normalizeProduct's category resolution exactly: the requested
 * category when the row is a direct member, otherwise the row's first joined
 * category (e.g. a subcategory-only member resolves to the CHILD slug). That
 * mismatch is load-bearing: canPublishProductComparePage and the compare link
 * graph both require category_slug === categorySlug, which keeps
 * subcategory-only and legacy-matched doorway compare pages non-indexable.
 */
function resolveRowCategorySlug(
  row: CompareCategoryInventoryRow,
  requestedCategorySlug: string
): string {
  const joinedSlugs = (row.product_categories ?? [])
    .flatMap((entry) => {
      const categories = entry?.categories;
      if (Array.isArray(categories)) {
        return categories;
      }
      return categories ? [categories] : [];
    })
    .map((category) => category?.slug)
    .filter((slug): slug is string => Boolean(slug));

  const joinedSlug =
    joinedSlugs.find((slug) => slug === requestedCategorySlug) ||
    joinedSlugs[0];

  return joinedSlug || (row.category ? generateSlug(row.category) : 'general');
}

function toInventoryProduct(
  row: CompareCategoryInventoryRow,
  categorySlug: string
): CompareCategoryInventoryProduct | null {
  // Same slug fallback as normalizeProduct (`raw.slug || raw.id`) so slug-less
  // rows keep participating in brand counts and membership checks.
  const slug = row.slug || row.id;

  if (!slug || !row.name) {
    return null;
  }

  const price =
    typeof row.price === 'number' ? row.price : Number(row.price) || 0;

  return {
    slug,
    name: row.name,
    brand: row.brand ?? null,
    price,
    category_slug: resolveRowCategorySlug(row, categorySlug),
    status: 'active',
    product_key_specs: extractComparableKeySpecs(row.product_key_specs),
  };
}

/**
 * Lightweight, remote-cacheable category product projection for compare and
 * indexability decisions.
 *
 * Compare pages previously reused the category page's rich product payload
 * (descriptions, images, stock — dozens of chunked queries per request for
 * large categories, deliberately not remote-cacheable). Compare eligibility
 * only needs slug/name/brand/price/key-specs, so this single bounded query is
 * shared across every compare URL in the category as one small remote entry.
 */
export async function getCachedCompareCategoryInventory(
  merchantId: string,
  categorySlug: string
): Promise<CompareCategoryInventory> {
  // LOCAL 'use cache' (not remote): this ~1MB entry is filled inside the
  // compare page model, whose large Vercel remote-cache SET (RemoteCacheHandler
  // K.set) hangs and never persists — the root of the ~30-34s compare stall.
  // Local cache has no write round-trip. See getCachedComparePageModel /
  // getCachedMerchant for the same remote→local rationale.
  'use cache';
  try {
    // 'products' (revalidate 1800), NOT 'categories' (3600): as a LOCAL entry
    // (see the directive note above), tag revalidation only evicts the mutating
    // instance, so bound cross-instance staleness of the embedded price to
    // ~30min. This query is <1s, so refills remain inexpensive.
    cacheLife('products');
    cacheTag(
      'category-page-data',
      'products',
      'categories',
      `products-${merchantId}`,
      `categories-${merchantId}`
    );
  } catch {
    // Unit tests do not run with Next cacheComponents enabled.
  }

  const shell = await getCachedCompareCategoryShell(merchantId, categorySlug);
  const fallbackName = shell.fallbackName ?? '';

  if (shell.isCollection) {
    return { isCollection: true, fallbackName, products: [] };
  }

  const scope = shell.productScope;
  // The fail-loud shell reader throws on transient category/scope failures
  // before either cache entry can commit. A successful legacy scope therefore
  // means a genuine no-row category, not a degraded database response.

  if (scope.kind === 'none' || scope.kind === 'collection') {
    return { isCollection: false, fallbackName, products: [] };
  }

  const supabase = getPublicSupabaseClient();
  let query = supabase
    .from('products')
    .select(
      scope.kind === 'category'
        ? // `!inner` + the `.in` filter below restrict the embedded membership
          // rows to the requested scope, so resolveRowCategorySlug sees the
          // same filtered joins the old rich-payload path fed normalizeProduct.
          `${COMPARE_CATEGORY_INVENTORY_SELECT}, product_categories!inner(category_id, categories(slug))`
        : `${COMPARE_CATEGORY_INVENTORY_SELECT}, product_categories(categories(slug))`
    )
    .eq('merchant_id', merchantId)
    .eq('status', 'active');

  if (scope.kind === 'category') {
    query = query.in('product_categories.category_id', scope.categoryIds);
  } else {
    // Legacy fallback for category URLs that predate canonical category rows —
    // mirrors getCachedCategoryPageProductIds' legacy branch VERBATIM
    // (including its unescaped ilike pattern) so compare membership can never
    // drift from what the category listing itself shows. Harden both together
    // or not at all.
    const sanitizedCategoryName = scope.categoryName.replace(/[,().]/g, '');
    query = query.or(
      `category.ilike.%${sanitizedCategoryName}%,brand.ilike.%${sanitizedCategoryName}%,name.ilike.%${sanitizedCategoryName}%`
    );
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT);

  if (error) {
    console.error('Error fetching compare category inventory:', {
      merchantId,
      categorySlug,
      error,
    });
    // Throw so Cache Components skips caching this failure — returning an
    // empty inventory would cache "category has no products" for the full
    // window after one transient DB error and 404 every compare page in it.
    throw error;
  }

  const rows = (data ?? []) as CompareCategoryInventoryRow[];

  if (rows.length === COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT) {
    // Truncation is unreachable today (largest live category ≈ 330 active
    // products) but would silently bias brand candidate selection and the
    // brand active-model counts, which read from this same bounded set. Emit a
    // signal so we upgrade to an uncapped brand aggregate BEFORE any category
    // approaches the cap, instead of discovering it from wrong brand pages.
    console.warn('COMPARE_INVENTORY_CAP_HIT', {
      merchantId,
      categorySlug,
      limit: COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT,
    });
  }

  const products = rows
    .map((row) => toInventoryProduct(row, categorySlug))
    .filter(
      (product): product is CompareCategoryInventoryProduct => product !== null
    );

  return { isCollection: false, fallbackName, products };
}
