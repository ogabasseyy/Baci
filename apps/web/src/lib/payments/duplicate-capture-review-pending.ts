import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * Metadata flag requeueing a completed capture for a filing-only
 * duplicate-review retry. Both duplicate filings can fail after the
 * atomic finalizer already completed the row; the completed row then
 * sits on a paid order no sweep reselects, so the flag keeps the
 * captured extra payment retryable until its review lands.
 */
export const DUPLICATE_CAPTURE_REVIEW_PENDING_KEY =
  'duplicate_capture_review_pending';

async function setPendingMarker(
  supabase: Pick<SupabaseClient, 'rpc'>,
  transactionId: string,
  pending: boolean
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc(
      'set_duplicate_capture_review_pending_v1',
      { p_pending: pending, p_transaction_id: transactionId }
    );
    if (error || data !== true) {
      logger.error({
        error,
        message: 'Failed to update duplicate-capture review retry marker',
        pending,
        transactionId,
      });
      return false;
    }
    return true;
  } catch (error) {
    logger.error({
      error,
      message: 'Failed to update duplicate-capture review retry marker',
      pending,
      transactionId,
    });
    return false;
  }
}

/**
 * Best-effort: a failed set during a total outage leaves the row
 * unmarked (the caller already records the filing failure), and a
 * failed clear only reselects a reviewed row whose refiling dedupes.
 */
export function setDuplicateCaptureReviewPending(
  supabase: Pick<SupabaseClient, 'rpc'>,
  transactionId: string
): Promise<boolean> {
  return setPendingMarker(supabase, transactionId, true);
}

export function clearDuplicateCaptureReviewPending(
  supabase: Pick<SupabaseClient, 'rpc'>,
  transactionId: string
): Promise<boolean> {
  return setPendingMarker(supabase, transactionId, false);
}
