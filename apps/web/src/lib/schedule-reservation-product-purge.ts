import type { SupabaseClient } from '@supabase/supabase-js';
import { after } from 'next/server';
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
          typeof settings.prize_product_id === 'string'
        ) {
          productIds = [settings.prize_product_id];
        }
      }
      await scheduleOrderProductBlogPurge({ merchantId, productIds, supabase });
    } catch {
      // The prize-target read failed after the launch path already expired
      // the Next enrichment: the affected product is unknown, so evict the
      // merchant hostname (a superset) rather than leaving the Cloudflare
      // PDP and related article advertising pre-reservation availability
      // until TTL. There is no durable retry behind this path.
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
