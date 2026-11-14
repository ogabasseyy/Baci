import { logger } from '@/lib/logger';
import type {
  AlertSupabase,
  PriorAlertAttempt,
  RefundReviewAlertOrder,
} from '@/lib/orders/refund-alert-types';

/**
 * Record one send attempt for a review. A first attempt inserts the ledger
 * row (attempts = 1); a re-drive compare-and-sets the attempt count so two
 * workers cannot both re-send. The row is never deleted on failure: every
 * attempt, definite or uncertain, counts toward the cool-down and cap.
 */
type ClaimResult = 'claimed' | 'duplicate' | 'error';

export async function claimAlert(
  supabase: AlertSupabase,
  review: { id: string },
  order: RefundReviewAlertOrder,
  prior: PriorAlertAttempt | null,
  signal?: AbortSignal
): Promise<ClaimResult> {
  if (prior) {
    const reclaim = supabase
      .from('order_cancellation_refund_alerts')
      .update({
        attempts: prior.attempts + 1,
        last_attempt_at: new Date().toISOString(),
        undeliverable_at: null,
      })
      .eq('review_id', review.id)
      .eq('attempts', prior.attempts)
      .is('confirmed_at', null)
      .select('review_id');
    const { data, error } = await (signal
      ? reclaim.abortSignal(signal)
      : reclaim);
    if (error) {
      logger.error({
        error,
        message: 'Cancellation refund alert re-claim failed',
        orderId: order.id,
        reviewId: review.id,
      });
      return 'error';
    }
    // No row matched: another worker already re-claimed it (benign).
    return Array.isArray(data) && data.length > 0 ? 'claimed' : 'duplicate';
  }
  const insert = supabase.from('order_cancellation_refund_alerts').insert({
    merchant_id: order.merchant_id,
    order_id: order.id,
    review_id: review.id,
  });
  const { error } = await (signal ? insert.abortSignal(signal) : insert);
  if (!error) return 'claimed';
  if (error.code === '23505') return 'duplicate';
  logger.error({
    error,
    message: 'Cancellation refund alert claim failed',
    orderId: order.id,
    reviewId: review.id,
  });
  return 'error';
}

export async function confirmClaim(
  supabase: AlertSupabase,
  reviewId: string
): Promise<void> {
  // Never rejects: the write may be left detached (bounded wait, late abort).
  try {
    const { error } = await supabase
      .from('order_cancellation_refund_alerts')
      .update({ confirmed_at: new Date().toISOString() })
      .eq('review_id', reviewId);
    if (error) throw error;
  } catch (error) {
    // Left unconfirmed, the review can be re-driven after the cool-down.
    logger.error({
      error,
      message: 'Cancellation refund alert could not be confirmed',
      reviewId,
    });
  }
}

/**
 * Neither push nor email is available: restore the attempt count (so the
 * retry cap is not consumed) and stamp undeliverable_at, which puts the
 * review on the long re-check cool-down instead of the retry path.
 */
export async function markUndeliverable(
  supabase: AlertSupabase,
  reviewId: string,
  attempts: number
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('order_cancellation_refund_alerts')
      .update({ attempts, last_attempt_at: now, undeliverable_at: now })
      .eq('review_id', reviewId);
    if (error) throw error;
  } catch (error) {
    logger.error({
      error,
      message: 'Cancellation refund alert could not be marked undeliverable',
      reviewId,
    });
  }
}
