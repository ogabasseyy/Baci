import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

type ExistingKeyedOrderInput = Readonly<{
  merchantId: string;
  requestIdempotencyKey?: string | null;
  supabase: SupabaseClient;
}>;

/**
 * Returns true only when the database confirms an order already exists for
 * this merchant + idempotency key. Replay-sensitive validation uses it to
 * reach the order RPC's replay path instead of re-judging a confirmed retry
 * against current state (e.g. an expired shipping quote). Fail-soft: a probe
 * outage runs full validation, which is no worse than today's behavior.
 */
export async function hasExistingKeyedOrder({
  merchantId,
  requestIdempotencyKey,
  supabase,
}: ExistingKeyedOrderInput): Promise<boolean> {
  if (!requestIdempotencyKey) return false;

  const { data, error } = await supabase.rpc(
    'has_storefront_order_idempotency_key',
    {
      p_checkout_idempotency_key: requestIdempotencyKey,
      p_merchant_id: merchantId,
    }
  );
  if (error) {
    logger.warn({
      message:
        'Idempotent order pre-check failed; running full quote validation',
      merchantId,
      error,
    });
    return false;
  }

  return data === true;
}
