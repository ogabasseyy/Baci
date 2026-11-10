import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

export type CancellationRefundMode = 'automatic' | 'manual';

/**
 * The refund mode an already-cancelled order was cancelled with. A legacy
 * null means automatic. When the read fails this returns null (and logs):
 * callers must not guess a mode, because a wrong guess can tell a merchant to
 * refund by hand while an automatic refund is queued.
 */
export async function readPersistedCancellationRefundMode({
  merchantId,
  orderId,
  supabase,
}: {
  merchantId: string;
  orderId: string;
  supabase: Pick<SupabaseClient, 'from'>;
}): Promise<CancellationRefundMode | null> {
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
    return null;
  }
  return data.cancellation_refund_mode === 'manual' ? 'manual' : 'automatic';
}
