import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * Whether an order already exists for this (merchant, checkout
 * idempotency key) — the exact lookup the order-create RPC's replay
 * path uses. A confirmed existing order means the current request is
 * a response-loss retry and must replay the original order instead of
 * being re-judged against the merchant's current catalog state.
 * Probe errors are not a confirmed miss, so they log and report false
 * (the request then runs the full fail-closed creation path).
 */
export async function hasExistingCheckoutOrder({
  adminSupabase,
  merchantId,
  requestIdempotencyKey,
}: {
  adminSupabase: SupabaseClient;
  merchantId: string;
  requestIdempotencyKey: string;
}): Promise<boolean> {
  const { data: existingOrder, error: existingOrderError } = await adminSupabase
    .from('orders')
    .select('id')
    .eq('merchant_id', merchantId)
    .eq('checkout_idempotency_key', requestIdempotencyKey)
    .maybeSingle();

  if (existingOrderError) {
    logger.warn({
      message:
        'Existing checkout order probe failed; running full order creation checks',
      merchantId,
      error: existingOrderError,
    });
    return false;
  }

  return typeof existingOrder?.id === 'string' && existingOrder.id.length > 0;
}
