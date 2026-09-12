import type { SupabaseClient } from '@supabase/supabase-js';
import { expireProductBlogCacheReliable } from '@/lib/expire-product-blog-cache-reliable';
import { getPublishedBlogPostSlugsForProducts } from '@/lib/get-published-blog-post-slugs-for-products';
import { isValidUuid } from '@/lib/sanitize-core';
import { scheduleStorefrontProductPurge } from '@/lib/storefront-product-purge';
import type { StorefrontProductPurgeEntry } from '@/lib/storefront-product-purge-urls';

export interface ScheduleProductBlogPurgeInput {
  supabase: SupabaseClient;
  merchantId: string;
  merchantSlug?: string | null;
  productIds: readonly string[];
  entries: readonly StorefrontProductPurgeEntry[];
  categorySlugs?: readonly (string | null | undefined)[];
  /** Pass pre-delete results because the relationship rows may have cascaded. */
  blogPostSlugs?: readonly string[];
  /** Resolve pre-delete relationship IDs after the product mutation commits. */
  blogPostIds?: readonly string[];
  /** Keep the immediate product purge, but skip a second purge when no blog is linked. */
  skipWhenNoLinkedPosts?: boolean;
  /** The core product URLs were already evicted; schedule only related articles. */
  skipProductPurge?: boolean;
}

function normalizeBlogPostSlugs(slugs: readonly string[]) {
  return Array.from(
    new Set(slugs.map((slug) => slug.trim()).filter((slug) => slug.length > 0))
  );
}

function getPublishedBlogPostSlug(row: {
  published_at?: string | null;
  slug?: string | null;
  status?: string | null;
}) {
  if (
    row.status !== 'published' ||
    typeof row.published_at !== 'string' ||
    row.published_at.length === 0 ||
    typeof row.slug !== 'string'
  ) {
    return null;
  }
  const slug = row.slug.trim();
  return slug.length > 0 ? slug : null;
}

const BLOG_POST_ID_CHUNK_SIZE = 100;

async function getPublishedBlogPostSlugsByIds(
  supabase: SupabaseClient,
  merchantId: string,
  blogPostIds: readonly string[]
) {
  const normalizedIds = Array.from(
    new Set(
      blogPostIds
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && isValidUuid(id))
    )
  );
  const slugs: string[] = [];
  for (
    let start = 0;
    start < normalizedIds.length;
    start += BLOG_POST_ID_CHUNK_SIZE
  ) {
    const { data, error } = await supabase
      .from('blog_posts')
      .select('slug, status, published_at')
      .eq('merchant_id', merchantId)
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .in('id', normalizedIds.slice(start, start + BLOG_POST_ID_CHUNK_SIZE));
    if (error) throw error;
    for (const row of (data ?? []) as Array<{
      published_at?: string | null;
      slug?: string | null;
      status?: string | null;
    }>) {
      const slug = getPublishedBlogPostSlug(row);
      if (slug) slugs.push(slug);
    }
  }
  return slugs;
}

/**
 * Resolve and schedule the published article URLs affected by a product
 * mutation. This is best-effort cache invalidation: lookup or scheduling
 * failures are logged and never escape into the product mutation response.
 * Delete callers can provide a pre-delete slug snapshot because the join rows
 * are removed by the product mutation's cascade.
 */
export async function scheduleProductBlogPurge({
  supabase,
  merchantId,
  merchantSlug,
  productIds,
  entries,
  categorySlugs,
  blogPostSlugs,
  blogPostIds,
  skipWhenNoLinkedPosts = false,
  skipProductPurge = false,
}: ScheduleProductBlogPurgeInput): Promise<void> {
  try {
    const normalizedMerchantSlug = merchantSlug?.trim();
    if (!normalizedMerchantSlug || entries.length === 0) {
      return;
    }

    // Invalidate the Next data before the outer CDN purge can trigger a refill.
    await expireProductBlogCacheReliable(merchantId);

    const normalizedCategorySlugs = (categorySlugs ?? []).filter(
      (categorySlug): categorySlug is string =>
        typeof categorySlug === 'string' && categorySlug.trim().length > 0
    );
    let linkedSlugs: string[];
    if (blogPostIds !== undefined) {
      linkedSlugs = normalizeBlogPostSlugs(
        await getPublishedBlogPostSlugsByIds(supabase, merchantId, blogPostIds)
      );
      if (normalizedCategorySlugs.length > 0) {
        const categoryFallbackSlugs =
          await getPublishedBlogPostSlugsForProducts(
            supabase,
            merchantId,
            [],
            normalizedCategorySlugs
          );
        linkedSlugs = normalizeBlogPostSlugs([
          ...linkedSlugs,
          ...categoryFallbackSlugs,
        ]);
      }
    } else if (blogPostSlugs === undefined) {
      linkedSlugs = normalizeBlogPostSlugs(
        await getPublishedBlogPostSlugsForProducts(
          supabase,
          merchantId,
          productIds,
          normalizedCategorySlugs
        )
      );
    } else {
      linkedSlugs = normalizeBlogPostSlugs(blogPostSlugs);
      if (normalizedCategorySlugs.length > 0) {
        try {
          const categoryFallbackSlugs =
            await getPublishedBlogPostSlugsForProducts(
              supabase,
              merchantId,
              [],
              normalizedCategorySlugs
            );
          linkedSlugs = normalizeBlogPostSlugs([
            ...linkedSlugs,
            ...categoryFallbackSlugs,
          ]);
        } catch (error) {
          // A pre-delete snapshot is still useful if the post-delete category
          // fallback read fails; do not lose those direct article targets.
          console.warn(
            'Falling back to pre-delete product blog slugs after category lookup failed',
            { merchantId, error }
          );
        }
      }
    }

    if (linkedSlugs.length > 0) {
      scheduleStorefrontProductPurge(
        normalizedMerchantSlug,
        entries,
        skipProductPurge
          ? { blogPostSlugs: linkedSlugs, blogPostsOnly: true }
          : { blogPostSlugs: linkedSlugs }
      );
    } else if (!skipWhenNoLinkedPosts && !skipProductPurge) {
      scheduleStorefrontProductPurge(normalizedMerchantSlug, entries);
    }
  } catch (error) {
    console.warn('Skipped product blog purge scheduling', {
      merchantId,
      productCount: productIds.length,
      error,
    });
    if (!skipWhenNoLinkedPosts && !skipProductPurge) {
      // Keep the core product purge fail-safe when enrichment cannot read the
      // relationship table. Article URLs may wait for TTL, but PDP/listing
      // caches must still be evicted after the mutation commits.
      scheduleStorefrontProductPurge(merchantSlug, entries);
    }
  }
}
