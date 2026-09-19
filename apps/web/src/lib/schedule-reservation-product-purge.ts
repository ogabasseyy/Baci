import type { SupabaseClient } from '@supabase/supabase-js';
import { after } from 'next/server';
import { scheduleOrderProductBlogPurge } from './schedule-order-product-blog-purge';

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
      console.warn('Reservation cache purge deferred to durable invalidation', {
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
