import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

export interface CheckoutReplaySnapshot {
  orderId: string;
  /** Immutable condition prices captured by the committed order. */
  conditionPriceOverrides: Map<string, number>;
}

interface ReplaySnapshotRow {
  order_id?: unknown;
  items?: unknown;
}

/**
 * Loads the immutable snapshot of the order already committed for
 * this (merchant, checkout idempotency key) through the narrowly
 * scoped `storefront_checkout_replay_snapshot` RPC (service_role only)
 * on the route's server-side admin client. A
 * confirmed snapshot means the current request is a response-loss
 * retry and must replay the original order instead of being re-judged
 * against the merchant's current catalog state. Probe errors are not
 * a confirmed miss, so they log and report null (the request then
 * runs the full fail-closed creation path).
 */
export async function loadCheckoutReplaySnapshot({
  client,
  merchantId,
  requestIdempotencyKey,
}: {
  client: SupabaseClient;
  merchantId: string;
  requestIdempotencyKey: string;
}): Promise<CheckoutReplaySnapshot | null> {
  const { data, error } = await client.rpc(
    'storefront_checkout_replay_snapshot',
    {
      p_checkout_idempotency_key: requestIdempotencyKey,
      p_merchant_id: merchantId,
    }
  );

  if (error) {
    logger.warn({
      message:
        'Checkout replay snapshot probe failed; running full order creation checks',
      merchantId,
      error,
    });
    return null;
  }

  const row = (data ?? null) as ReplaySnapshotRow | null;
  if (!row || typeof row.order_id !== 'string' || !row.order_id) return null;

  const overrides = new Map<string, number>();
  if (Array.isArray(row.items)) {
    for (const item of row.items as Record<string, unknown>[]) {
      if (
        typeof item?.product_id === 'string' &&
        typeof item?.condition === 'string' &&
        item.condition &&
        !item?.variant_id
      ) {
        const price = Number(item.price);
        if (Number.isFinite(price) && price >= 0)
          overrides.set(
            JSON.stringify([item.product_id, item.condition]),
            price
          );
      }
    }
  }
  return { orderId: row.order_id, conditionPriceOverrides: overrides };
}
