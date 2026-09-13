import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * Check whether a merchant-rate request already created an order. Replays must
 * bypass current rate verification so an edited/deleted rate cannot invalidate
 * the original order's locked shipping fee.
 */
export async function hasExistingMerchantRateOrder({
  adminSupabase,
  merchantId,
  requestIdempotencyKey,
  shippingRateId,
}: {
  adminSupabase: SupabaseClient;
  merchantId: string;
  requestIdempotencyKey: string;
  shippingRateId: string;
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
        'Idempotent merchant-rate order pre-check failed; running full rate verification',
      merchantId,
      shippingRateId,
      error: existingOrderError,
    });
    return false;
  }

  return typeof existingOrder?.id === 'string' && existingOrder.id.length > 0;
}
