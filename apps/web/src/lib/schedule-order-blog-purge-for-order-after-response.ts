import type { SupabaseClient } from '@supabase/supabase-js';
import { after } from 'next/server';
import { revalidateProducts } from './cache-revalidation';
import { expireProductBlogCache } from './expire-product-blog-cache';
import { scheduleOrderProductBlogPurge } from './schedule-order-product-blog-purge';
import { scheduleStorefrontHostnamePurge } from './storefront-product-purge-hostnames';

interface OrderItemProductRow {
  product_id?: string | null;
}

export interface ScheduleOrderBlogPurgeForOrderInput {
  supabase: SupabaseClient;
  merchantId: string;
  orderId: string;
}

async function purgeOrderBlogProductsConservatively({
  supabase,
  merchantId,
  orderId,
  error,
}: ScheduleOrderBlogPurgeForOrderInput & { error: unknown }): Promise<void> {
  // The reclamation already committed; without product IDs the targeted purge
  // cannot run, so fall back to the bounded storefront-wide eviction rather
  // than leaving freshly reserved units advertised on the edge.
  try {
    const { data: merchantRow, error: merchantError } = await supabase
      .from('merchants')
      .select('slug')
      .eq('id', merchantId)
      .maybeSingle();
    const merchantSlug = (merchantRow as { slug?: unknown } | null)?.slug;
    if (
      merchantError ||
      typeof merchantSlug !== 'string' ||
      merchantSlug.trim().length === 0
    ) {
      throw merchantError ?? new Error('merchant slug unavailable');
    }
    // Hard-expire the merchant caches BEFORE the hostname purge: the
    // preceding revalidation is stale-while-revalidate, so the first
    // post-purge request could otherwise serve the pre-reclamation Next
    // snapshot and repopulate the edge with stale availability.
    revalidateProducts(merchantId, undefined, { expireImmediately: true });
    expireProductBlogCache(merchantId);
    scheduleStorefrontHostnamePurge(merchantSlug.trim());
    console.warn('Purged storefront hostname after order-item lookup failed', {
      merchantId,
      orderId,
      error,
    });
  } catch (fallbackError) {
    console.warn(
      'Skipped order-related blog purge because order items lookup failed',
      { merchantId, orderId, error: fallbackError }
    );
  }
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
      await purgeOrderBlogProductsConservatively({
        supabase,
        merchantId,
        orderId,
        error,
      });
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
    // A rejected order-items read must take the same conservative path as
    // an `{ error }` result: without product evidence the targeted purge
    // above cannot run, so evict by hostname instead of skipping silently.
    await purgeOrderBlogProductsConservatively({
      error,
      merchantId,
      orderId,
      supabase,
    });
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
