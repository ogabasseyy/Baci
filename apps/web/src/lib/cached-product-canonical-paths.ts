import { cacheLife, cacheTag } from 'next/cache';
import { getProductUrl } from '@/lib/seo-utils';
import { resolveStorefrontProductCategory } from '@/lib/storefront-product-category-precedence';
import { createPublicClient } from '@/lib/supabase/public';

interface CanonicalPathJoinedCategory {
  id?: string;
  is_active?: boolean | null;
  name?: string;
  slug?: string;
}

interface CanonicalPathProductRow {
  id: string;
  name: string;
  slug: string | null;
  category: string | null;
  categories:
    | CanonicalPathJoinedCategory
    | CanonicalPathJoinedCategory[]
    | null;
  product_categories:
    | {
        category_id?: string | null;
        categories:
          | CanonicalPathJoinedCategory
          | CanonicalPathJoinedCategory[]
          | null;
      }[]
    | null;
}

// Mirrors the PDP snapshot's canonical decision, which is the arbiter for
// categorized URLs: active direct category_id join first, then the active
// product_categories junction. The legacy category text is only used when no
// active joined category exists; otherwise content links would emit a stale
// URL that the PDP immediately 308s to the relation-backed category.
function normalizeJoinedCategory(
  row: CanonicalPathProductRow
): CanonicalPathJoinedCategory | null {
  return resolveStorefrontProductCategory(row);
}

/**
 * Resolves active product slugs to their canonical storefront paths
 * (`/<category-slug>/<product-slug>`), so curated internal links always point
 * at the URL the PDP would canonicalize to instead of going through a 308.
 * Slugs that no longer resolve to an active product are omitted, letting
 * callers drop dead links instead of emitting 404s.
 *
 * `canonical_url` is intentionally NOT selected, so `getProductUrl()` always
 * derives the path from the live slug + category join. The PDP's declared
 * canonical uses `getValidatedProductUrl()`, which discards any stored
 * `canonical_url` whose path diverges from the derived path — so the derived
 * path IS the declared canonical. Honoring a divergent `canonical_url` here
 * would instead link to a slug the PDP lookup can't resolve (404) or to a
 * category-mismatched path that 308s back to itself (redirect loop).
 */
export async function getCachedProductCanonicalPaths(
  merchantId: string,
  productSlugs: string[],
  // Callers whose fail-open behavior depends on DISTINGUISHING "no rewrite
  // exists" from "the lookup failed" (content link canonicalization) must opt
  // into throwing; default callers (the /products link hub) prefer an empty
  // map so a transient error drops links for one render instead of erroring
  // the page.
  options: { throwOnQueryError?: boolean } = {}
): Promise<Record<string, string>> {
  'use cache';
  cacheLife('products');
  // product-index-<id> busts on product mutations (revalidateProducts);
  // categories-<id> busts on category renames (revalidateCategories), which
  // change the resolved paths without touching any product row.
  cacheTag(
    'products',
    `product-index-${merchantId}`,
    `categories-${merchantId}`
  );

  if (productSlugs.length === 0) {
    return {};
  }

  const supabase = createPublicClient({
    clientInfo: 'baci-product-canonical-paths',
  });

  const { data, error } = await supabase
    .from('products')
    .select(
      'id, name, slug, category, categories:category_id(name, slug, is_active), product_categories(category_id, categories(name, slug, is_active))'
    )
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .order('category_id', {
      ascending: true,
      referencedTable: 'product_categories',
    })
    .in('slug', productSlugs);

  if (error) {
    if (options.throwOnQueryError) {
      throw error;
    }
    console.error('Error fetching product canonical paths:', error);
    return {};
  }

  const pathsBySlug: Record<string, string> = {};
  for (const row of (data ?? []) as unknown as CanonicalPathProductRow[]) {
    if (!row.slug) {
      continue;
    }
    pathsBySlug[row.slug] = getProductUrl({
      id: row.id,
      name: row.name,
      slug: row.slug,
      category: row.category,
      categories: normalizeJoinedCategory(row),
    });
  }

  return pathsBySlug;
}
