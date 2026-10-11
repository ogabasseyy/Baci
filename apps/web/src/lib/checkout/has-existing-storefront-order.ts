import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * Retry evidence for mutable catalog validation (F1 pattern): whether this
 * merchant-scoped idempotency key already created an order. Guest-safe
 * boolean probe — no order fields cross the boundary. Fail-open (false) on
 * probe errors: an outage degrades to full validation (status quo), never
 * a new 500, and the order RPC's request-hash check remains the authority
 * for conflict detection.
 */
export async function hasExistingStorefrontOrderForKey({
  merchantId,
  requestIdempotencyKey,
  supabase,
}: {
  merchantId: string;
  requestIdempotencyKey: string;
  supabase: SupabaseClient;
}): Promise<boolean> {
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
        'Idempotent order pre-check failed; running full catalog validation',
      merchantId,
      error,
    });
    return false;
  }
  return data === true;
}
