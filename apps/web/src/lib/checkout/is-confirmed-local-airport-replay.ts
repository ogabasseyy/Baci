import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

type ConfirmedLocalAirportReplayInput = Readonly<{
  merchantId: string;
  requestIdempotencyKey?: string | null;
  supabase: SupabaseClient;
}>;

/** Returns true only when the database confirms an existing airport replay. */
export async function isConfirmedLocalAirportReplay({
  merchantId,
  requestIdempotencyKey,
  supabase,
}: ConfirmedLocalAirportReplayInput): Promise<boolean> {
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
        'Idempotent local-airport order pre-check failed; rejecting the stale fee',
      merchantId,
      error,
    });
    return false;
  }

  return data === true;
}
