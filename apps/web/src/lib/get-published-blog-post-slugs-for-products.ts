import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeStorefrontCategoryValue } from '@/lib/normalize-storefront-category-value';
import { isValidUuid } from '@/lib/sanitize-core';
import { filterCategoryBlogPostRowsWithoutActiveLinks } from './filter-category-blog-post-rows';
import { getBlogCategoryLookup } from './get-blog-category-lookup';

const CATEGORY_FALLBACK_PAGE_SIZE = 256;
const LINKED_POST_PAGE_SIZE = 256;
// Keep the PostgREST `.in(...)` URL bounded; relationship reads still paginate.
const LINKED_PRODUCT_ID_CHUNK_SIZE = 100;

interface LinkedBlogPostRow {
  blog_post_id?: string | null;
  id?: string | null;
  blog_posts?:
    | {
        published_at?: string | null;
        slug?: string | null;
        status?: string | null;
      }
    | Array<{
        published_at?: string | null;
        slug?: string | null;
        status?: string | null;
      }>
    | null;
}
interface BlogPostFields {
  category?: string | null;
  published_at?: string | null;
  slug?: string | null;
  status?: string | null;
}
interface CategoryBlogPostRow extends BlogPostFields {
  id?: string | null;
}
function getBlogPostRow(value: LinkedBlogPostRow['blog_posts']): {
  published_at?: string | null;
  slug?: string | null;
  status?: string | null;
} | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function getPublishedBlogPostSlug(post: BlogPostFields | null | undefined) {
  if (
    post?.status !== 'published' ||
    typeof post.published_at !== 'string' ||
    post.published_at.length === 0 ||
    typeof post.slug !== 'string'
  ) {
    return null;
  }

  const slug = post.slug.trim();
  return slug.length > 0 ? slug : null;
}
function getCanonicalCategoryPostRows(
  rows: readonly CategoryBlogPostRow[],
  canonicalCategorySlugs: readonly string[]
) {
  const canonicalCategories = new Set(canonicalCategorySlugs);
  return rows.filter((post) => {
    const category = normalizeStorefrontCategoryValue(post.category);
    return category !== null && canonicalCategories.has(category);
  });
}

type CategoryFallbackQuery = 'exact' | 'canonical';

async function fetchCategoryFallbackRows(
  supabase: SupabaseClient,
  merchantId: string,
  categoryCandidates: readonly string[],
  canonicalCategoryFilters: readonly string[],
  queryKind: CategoryFallbackQuery
) {
  const rows: CategoryBlogPostRow[] = [];

  const filters =
    queryKind === 'exact' ? [''] : Array.from(canonicalCategoryFilters);
  for (const filter of filters) {
    for (let page = 0; ; page += 1) {
      let query = supabase
        .from('blog_posts')
        .select('id, slug, status, published_at, category')
        .eq('merchant_id', merchantId)
        .eq('status', 'published');

      query =
        queryKind === 'exact'
          ? query.in('category', Array.from(categoryCandidates))
          : query.or(filter);

      const { data, error } = await query
        .order('published_at', { ascending: false })
        // Keep page boundaries stable when bulk-published posts share the same
        // timestamp (a common outcome of imports and scheduled releases).
        .order('slug', { ascending: true })
        .range(
          page * CATEGORY_FALLBACK_PAGE_SIZE,
          (page + 1) * CATEGORY_FALLBACK_PAGE_SIZE - 1
        );

      if (error) {
        return { error, rows };
      }

      const pageRows = (data as unknown as CategoryBlogPostRow[]) ?? [];
      rows.push(...pageRows);

      if (pageRows.length < CATEGORY_FALLBACK_PAGE_SIZE) {
        break;
      }
    }
  }

  return { error: null, rows };
}

async function fetchLinkedBlogPostRows(
  supabase: SupabaseClient,
  merchantId: string,
  productIds: readonly string[]
) {
  const rows: LinkedBlogPostRow[] = [];
  let firstError: unknown = null;

  for (
    let chunkStart = 0;
    chunkStart < productIds.length;
    chunkStart += LINKED_PRODUCT_ID_CHUNK_SIZE
  ) {
    const productIdChunk = productIds.slice(
      chunkStart,
      chunkStart + LINKED_PRODUCT_ID_CHUNK_SIZE
    );
    for (let page = 0; ; page += 1) {
      const { data, error } = await supabase
        .from('blog_post_products')
        .select(
          'id, blog_post_id, blog_posts!inner(slug, status, published_at)'
        )
        .eq('merchant_id', merchantId)
        .eq('blog_posts.status', 'published')
        .not('blog_posts.published_at', 'is', null)
        .in('product_id', productIdChunk)
        .order('blog_post_id', { ascending: true })
        .order('id', { ascending: true })
        .range(
          page * LINKED_POST_PAGE_SIZE,
          (page + 1) * LINKED_POST_PAGE_SIZE - 1
        );

      if (error) {
        firstError ??= error;
        break;
      }

      const pageRows = (data as unknown as LinkedBlogPostRow[]) ?? [];
      rows.push(...pageRows);

      if (pageRows.length < LINKED_POST_PAGE_SIZE) {
        break;
      }
    }
  }

  return { error: firstError, rows };
}

/**
 * Find published storefront blog posts whose related-product rail can be
 * affected by the changed products. Explicit product relationships are joined
 * with a paginated category fallback for legacy posts that derive their rail
 * from the product category instead of `blog_post_products`. Results are
 * deduplicated before callers evict their edge-cached article URLs. Any read
 * failure is fail-open because cache expiry remains safe and a product
 * mutation must not fail on best-effort CDN invalidation.
 */
export async function getPublishedBlogPostSlugsForProducts(
  supabase: SupabaseClient,
  merchantId: string,
  productIds: readonly string[],
  categorySlugs: readonly string[] = []
): Promise<string[]> {
  const normalizedMerchantId = merchantId.trim();
  const normalizedProductIds = Array.from(
    new Set(
      productIds
        .map((productId) => productId.trim())
        .filter((productId) => productId.length > 0 && isValidUuid(productId))
    )
  );
  const {
    candidates: categoryCandidates,
    canonicalFilters: canonicalCategoryFilters,
    canonicalSlugs: canonicalCategorySlugs,
  } = getBlogCategoryLookup(categorySlugs);

  if (
    !normalizedMerchantId ||
    (normalizedProductIds.length === 0 && categoryCandidates.length === 0)
  ) {
    return [];
  }

  const slugs = new Set<string>();

  if (normalizedProductIds.length > 0) {
    try {
      const { rows, error } = await fetchLinkedBlogPostRows(
        supabase,
        normalizedMerchantId,
        normalizedProductIds
      );

      if (error) {
        console.error(
          'Failed to resolve published blog posts for product purge (continuing without article purge):',
          { merchantId: normalizedMerchantId, error }
        );
      }
      for (const row of rows) {
        const slug = getPublishedBlogPostSlug(getBlogPostRow(row.blog_posts));
        if (slug) slugs.add(slug);
      }
    } catch (error) {
      console.error(
        'Failed to resolve published blog posts for product purge (continuing without article purge):',
        { merchantId: normalizedMerchantId, error }
      );
    }
  }

  if (categoryCandidates.length > 0) {
    try {
      const { rows: exactRows, error: exactError } =
        await fetchCategoryFallbackRows(
          supabase,
          normalizedMerchantId,
          categoryCandidates,
          [],
          'exact'
        );

      if (exactError) {
        console.error(
          'Failed to resolve category-fallback blog posts for product purge (continuing with rows already fetched):',
          { merchantId: normalizedMerchantId, error: exactError }
        );
      }
      const exactRowsWithoutActiveLinks =
        await filterCategoryBlogPostRowsWithoutActiveLinks(
          supabase,
          normalizedMerchantId,
          exactRows
        );
      for (const post of exactRowsWithoutActiveLinks) {
        const slug = getPublishedBlogPostSlug(post);
        if (slug) slugs.add(slug);
      }

      if (canonicalCategoryFilters.length > 0) {
        const { rows: canonicalRows, error: canonicalError } =
          await fetchCategoryFallbackRows(
            supabase,
            normalizedMerchantId,
            categoryCandidates,
            canonicalCategoryFilters,
            'canonical'
          );

        if (canonicalError) {
          console.error(
            'Failed to resolve canonical category-fallback blog posts for product purge (continuing with rows already fetched):',
            { merchantId: normalizedMerchantId, error: canonicalError }
          );
        }
        const canonicalRowsWithoutActiveLinks =
          await filterCategoryBlogPostRowsWithoutActiveLinks(
            supabase,
            normalizedMerchantId,
            getCanonicalCategoryPostRows(canonicalRows, canonicalCategorySlugs)
          );
        for (const post of canonicalRowsWithoutActiveLinks) {
          const slug = getPublishedBlogPostSlug(post);
          if (slug) slugs.add(slug);
        }
      }
    } catch (error) {
      console.error(
        'Failed to resolve category-fallback blog posts for product purge (continuing without category article purge):',
        { merchantId: normalizedMerchantId, error }
      );
    }
  }

  return Array.from(slugs);
}
