import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { readPersistedCancellationRefundMode } from '@/lib/orders/read-persisted-cancellation-refund-mode';

export type CancellationRefundOutcome =
  | 'manual_required'
  | 'queued_if_required'
  | 'unknown';

/**
 * What the cancel response tells clients about the refund. Never claims
 * `manual_required` unless it is certain: that wording tells a merchant to
 * repay by hand, which double-pays if an automatic refund is queued or in
 * flight. Any read problem, and any manual cancellation with a refund
 * already in flight on a leg, reports `unknown` so clients show neutral
 * "check the Refund card" copy.
 */
export async function resolveCancellationRefundOutcome({
  alreadyCancelled,
  merchantId,
  orderId,
  requested,
  supabase,
}: {
  alreadyCancelled: boolean;
  merchantId: string;
  orderId: string;
  requested: 'automatic' | 'manual';
  supabase: Pick<SupabaseClient, 'from'>;
}): Promise<CancellationRefundOutcome> {
  let mode: 'automatic' | 'manual' = requested;
  if (alreadyCancelled) {
    const persisted = await readPersistedCancellationRefundMode({
      merchantId,
      orderId,
      supabase,
    });
    if (persisted === null) return 'unknown';
    mode = persisted;
  }
  if (mode === 'automatic') return 'queued_if_required';
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('id')
      .eq('order_id', orderId)
      .eq('merchant_id', merchantId)
      .eq('transaction_type', 'payment')
      .eq('status', 'refund_pending')
      .limit(1);
    if (error || !data) {
      logger.warn({
        message: 'Could not check in-flight refunds for a cancel-only order',
        orderId,
        merchantId,
        error,
      });
      return 'unknown';
    }
    return data.length > 0 ? 'unknown' : 'manual_required';
  } catch (error) {
    logger.warn({
      message: 'In-flight refund check failed for a cancel-only order',
      orderId,
      merchantId,
      error,
    });
    return 'unknown';
  }
}
