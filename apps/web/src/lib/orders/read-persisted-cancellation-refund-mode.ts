import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

export type CancellationRefundMode = 'automatic' | 'manual';

/**
 * The refund mode an already-cancelled order was cancelled with. A legacy
 * null means automatic. When the read fails the requested mode is returned
 * (and the failure logged): the replay itself already succeeded.
 */
export async function readPersistedCancellationRefundMode({
  fallback,
  merchantId,
  orderId,
  supabase,
}: {
  fallback: CancellationRefundMode;
  merchantId: string;
  orderId: string;
  supabase: Pick<SupabaseClient, 'from'>;
}): Promise<CancellationRefundMode> {
  const { data, error } = await supabase
    .from('orders')
    .select('cancellation_refund_mode')
    .eq('id', orderId)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (error || !data) {
    logger.warn({
      message: 'Could not read the persisted cancellation refund mode',
      orderId,
      merchantId,
      error,
    });
    return fallback;
  }
  return data.cancellation_refund_mode === 'manual' ? 'manual' : 'automatic';
}
