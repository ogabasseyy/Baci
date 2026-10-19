import type { SupabaseClient } from '@supabase/supabase-js';
import { after } from 'next/server';
import { revalidateProducts } from './cache-revalidation';
import { expireProductBlogCache } from './expire-product-blog-cache';
import { scheduleStorefrontHostnamePurge } from './storefront-product-purge-hostnames';

/** Called only after the tracking-token-authorized reuse RPC succeeds. */
export function scheduleReusedOrderInventoryPurge({
  merchantId,
  supabase,
}: {
  merchantId: string;
  supabase: SupabaseClient;
}): void {
  // Guest order items are intentionally not SELECT-visible under RLS. Use a
  // bounded merchant purge instead of introducing a privileged order read.
  revalidateProducts(merchantId, undefined, { expireImmediately: true });
  expireProductBlogCache(merchantId);
  const run = async () => {
    try {
      const { data, error } = await supabase
        .from('merchants')
        .select('slug')
        .eq('id', merchantId)
        .maybeSingle();
      if (error) throw error;
      if (data?.slug) scheduleStorefrontHostnamePurge(data.slug);
    } catch {
      console.warn(
        'Reusable order edge purge deferred to durable invalidation',
        { merchantId }
      );
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
