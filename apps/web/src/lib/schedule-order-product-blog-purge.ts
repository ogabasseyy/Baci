import type { SupabaseClient } from '@supabase/supabase-js';
import { enrichProductPurgeEntries } from '@/lib/authoritative-product-purge-enrichment';
import { revalidateProductSlugs } from '@/lib/cache-revalidation';
import { expireProductBlogCacheReliable } from '@/lib/expire-product-blog-cache-reliable';
import { scheduleStorefrontProductPurge } from '@/lib/storefront-product-purge';

interface ScheduleOrderProductBlogPurgeInput {
  merchantId: string;
  merchantSlug?: string | null;
  productIds: readonly (string | null | undefined)[];
  supabase: SupabaseClient;
}

/**
 * Evict edge-cached storefront articles whose related-product rail may have
 * changed after checkout or order cancellation. Product/category mutations
 * already handle the Next tags; this helper covers the additional Cloudflare
 * document that embeds the rail, including legacy category-fallback posts.
 *
 * The lookup is deliberately best-effort. A cache purge failure must never
 * turn a completed order or cancellation into an error; the article TTL and
 * the next product-tag invalidation remain safe fallbacks.
 */
export async function scheduleOrderProductBlogPurge({
  merchantId,
  merchantSlug: suppliedMerchantSlug,
  productIds,
  supabase,
}: ScheduleOrderProductBlogPurgeInput): Promise<void> {
  const normalizedProductIds = Array.from(
    new Set(
      productIds
        .map((productId) => productId?.trim())
        .filter((productId): productId is string => Boolean(productId))
    )
  );
  if (normalizedProductIds.length === 0) {
    return;
  }

  let merchantSlug = suppliedMerchantSlug?.trim() || null;
  if (!merchantSlug) {
    try {
      const { data, error } = await supabase
        .from('merchants')
        .select('slug')
        .eq('id', merchantId)
        .maybeSingle<{ slug: string | null }>();
      if (error) {
        console.warn(
          'Skipped order-related blog purge because merchant slug lookup failed',
          { merchantId, error }
        );
        return;
      }
      merchantSlug = data?.slug?.trim() || null;
    } catch (error) {
      console.warn(
        'Skipped order-related blog purge because merchant slug lookup failed',
        { merchantId, error }
      );
      return;
    }
  }
  if (!merchantSlug) {
    return;
  }

  const products = normalizedProductIds.map((id) => ({ id }));
  try {
    const { entries, blogPostSlugs, resolvedSlugs } =
      await enrichProductPurgeEntries(supabase, merchantId, products);
    if (entries.length === 0) {
      return;
    }

    revalidateProductSlugs(
      merchantId,
      resolvedSlugs ?? entries.map((entry) => entry.slug)
    );
    await expireProductBlogCacheReliable(merchantId);
    if (blogPostSlugs.length > 0) {
      scheduleStorefrontProductPurge(merchantSlug, entries, {
        blogPostSlugs,
      });
    } else {
      // The relationship lookup can legitimately find no published article,
      // but the order still changed the product PDP/listing. Keep the core
      // purge in that case so those pages cannot remain stale until TTL.
      scheduleStorefrontProductPurge(merchantSlug, entries);
    }
  } catch (error) {
    console.warn('Skipped order-related blog purge after enrichment failed', {
      merchantId,
      error,
    });
  }
}
