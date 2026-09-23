import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

export interface ImmediateOrderNotificationClaim {
  /**
   * Whether this caller won delivery ownership and must run the after()
   * notification (artifacts, DVA retry, email). False when another attempt
   * is actively delivering, already sent, or the claim RPC errored — the
   * caller must skip, never double-send.
   */
  shouldDeliver: boolean;
}

/**
 * Atomically claims an order's immediate (invoice / POD / Pay for Me /
 * wallet-or-voucher-paid) notification before after() delivery. First
 * claimant wins; concurrent duplicates observe fresh processing and skip;
 * replays reclaim failed or crashed-mid-send (stale processing) claims so
 * unfinished delivery resumes instead of being suppressed forever.
 * Never rejects: a claim failure skips delivery (logged) rather than
 * breaking checkout or risking an unguarded duplicate send.
 */
export async function claimImmediateOrderNotification(
  supabase: SupabaseClient,
  orderId: string
): Promise<ImmediateOrderNotificationClaim> {
  const skipped = { shouldDeliver: false };
  try {
    const { data, error } = await supabase.rpc(
      'claim_immediate_order_notification',
      { p_order_id: orderId }
    );
    if (error) {
      logger.error({
        message: 'Immediate order notification claim failed; skipping delivery',
        error,
        orderId,
      });
      return skipped;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object' || row.claimed !== true) {
      return skipped;
    }
    return { shouldDeliver: true };
  } catch (error) {
    logger.error({
      message: 'Immediate order notification claim raised; skipping delivery',
      error,
      orderId,
    });
    return skipped;
  }
}

/**
 * Records after() delivery: sent (terminal — replays skip) or failed
 * (releasable — the next replay resumes). Best-effort and never-rejecting
 * like the claim itself.
 */
export async function completeImmediateOrderNotification(
  supabase: SupabaseClient,
  orderId: string,
  sent: boolean
): Promise<void> {
  try {
    const { error } = await supabase.rpc(
      'complete_immediate_order_notification',
      { p_order_id: orderId, p_sent: sent }
    );
    if (error) {
      logger.error({
        message: 'Immediate order notification completion failed',
        error,
        orderId,
        sent,
      });
    }
  } catch (error) {
    logger.error({
      message: 'Immediate order notification completion raised',
      error,
      orderId,
      sent,
    });
  }
}
