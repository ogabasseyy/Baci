import type { SupabaseClient } from '@supabase/supabase-js';
import { after } from 'next/server';
import { revalidateProducts } from './cache-revalidation';
import { expireProductBlogCache } from './expire-product-blog-cache';
import { expireProductBlogCacheReliable } from './expire-product-blog-cache-reliable';
import { scheduleOrderProductBlogPurge } from './schedule-order-product-blog-purge';
import { scheduleStorefrontHostnamePurge } from './storefront-product-purge-hostnames';

/** Resolve reservation products only after the authorized mutation succeeds. */
export function scheduleReservationProductPurge({
  merchantId,
  sourceId,
  source,
  supabase,
}: {
  merchantId: string;
  sourceId: string;
  source: 'quiz';
  supabase: SupabaseClient;
}): void {
  const run = async () => {
    try {
      let productIds: string[] = [];
      {
        const { data, error } = await supabase
          .from('quiz_events')
          .select('settings')
          .eq('id', sourceId)
          .eq('merchant_id', merchantId)
          .maybeSingle();
        if (error) throw error;
        const settings: unknown = data?.settings;
        if (
          settings &&
          typeof settings === 'object' &&
          'prize_product_id' in settings &&
          typeof settings.prize_product_id === 'string' &&
          settings.prize_product_id.trim().length > 0
        ) {
          productIds = [settings.prize_product_id.trim()];
        }
      }
      if (productIds.length === 0) {
        throw new Error('Reservation target product unresolved');
      }
      await scheduleOrderProductBlogPurge({ merchantId, productIds, supabase });
    } catch {
      // Hard-expire merchant-wide PDP tags before the slug lookup or hostname
      // purge so Next cannot refill the edge with pre-reservation availability
      // even if the merchant slug read below fails.
      const broadPdpExpired =
        (expireProductBlogCache(merchantId) === true &&
          revalidateProducts(merchantId, undefined, {
            expireImmediately: true,
          }) === true) ||
        (await expireProductBlogCacheReliable(merchantId, {
          expireWidePdpDetails: true,
        }));
      if (!broadPdpExpired) {
        console.warn(
          'Skipped reservation hostname purge because PDP hard expiry failed',
          { merchantId, sourceId, source }
        );
        return;
      }
      try {
        const { data: merchant, error: merchantError } = await supabase
          .from('merchants')
          .select('slug')
          .eq('id', merchantId)
          .maybeSingle<{ slug: string | null }>();
        const merchantSlug = merchantError
          ? null
          : (merchant?.slug?.trim() ?? null);
        if (merchantSlug) {
          scheduleStorefrontHostnamePurge(merchantSlug);
          return;
        }
      } catch {
        // Fall through to the warn below: without the slug there is no
        // hostname to evict and the launch must still succeed.
      }
      console.warn('Reservation cache purge skipped; no fallback available', {
        merchantId,
        sourceId,
        source,
      });
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
