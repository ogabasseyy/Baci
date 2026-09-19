import type { SupabaseClient } from '@supabase/supabase-js';
import { after } from 'next/server';
import { scheduleOrderProductBlogPurge } from './schedule-order-product-blog-purge';

interface OrderItemProductRow {
  product_id?: string | null;
}

export interface ScheduleOrderBlogPurgeForOrderInput {
  supabase: SupabaseClient;
  merchantId: string;
  orderId: string;
}

async function purgeOrderBlogProducts({
  supabase,
  merchantId,
  orderId,
}: ScheduleOrderBlogPurgeForOrderInput): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('order_items')
      .select('product_id')
      .eq('order_id', orderId);
    if (error) {
      console.warn(
        'Skipped order-related blog purge because order items lookup failed',
        { merchantId, orderId, error }
      );
      return;
    }

    const productIds = Array.from(
      new Set(
        ((data ?? []) as OrderItemProductRow[])
          .map((item) => item.product_id?.trim())
          .filter((productId): productId is string => Boolean(productId))
      )
    );
    if (productIds.length === 0) {
      return;
    }

    await scheduleOrderProductBlogPurge({
      merchantId,
      productIds,
      supabase,
    });
  } catch (error) {
    console.warn(
      'Skipped order-related blog purge after order item lookup failed',
      {
        merchantId,
        orderId,
        error,
      }
    );
  }
}

/**
 * Queue related-article invalidation after serialized inventory reclamation.
 * The RPC has already committed the stock change; order-item and article
 * lookups stay outside the payment response and remain best-effort.
 */
export function scheduleOrderBlogPurgeForOrderAfterResponse(
  input: ScheduleOrderBlogPurgeForOrderInput
): void {
  try {
    after(() => purgeOrderBlogProducts(input));
  } catch {
    void purgeOrderBlogProducts(input);
  }
}
