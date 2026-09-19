import type { SupabaseClient } from '@supabase/supabase-js';
import { scheduleProductBlogPurgeAfterResponse } from '@/lib/schedule-product-blog-purge-after-response';
import { resolveProductPurgeCategorySegment } from '@/lib/storefront-product-purge-urls';

interface ScheduleNewProductBlogPurgeInput {
  category?: string | null;
  merchantId: string;
  merchantSlug?: string | null;
  name: string;
  productId: string;
  slug: string;
  status?: string | null;
  supabase: SupabaseClient;
}

/** Queue the category/article relationship lookup after a successful create response. */
export function scheduleNewProductBlogPurgeAfterResponse({
  category,
  merchantId,
  merchantSlug,
  name,
  productId,
  slug,
  status,
  supabase,
}: ScheduleNewProductBlogPurgeInput): void {
  if (status !== 'active') {
    return;
  }

  const purgeSlug = slug.trim() || productId;
  scheduleProductBlogPurgeAfterResponse({
    supabase,
    merchantId,
    merchantSlug,
    productIds: [productId],
    entries: [
      {
        slug: purgeSlug,
        categorySegment: resolveProductPurgeCategorySegment({
          slug: purgeSlug,
          name,
          category,
        }),
      },
    ],
    categorySlugs: category ? [category] : [],
    skipWhenNoLinkedPosts: true,
  });
}
