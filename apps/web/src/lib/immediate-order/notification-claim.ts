import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { createImmediateNotificationCompletionProof } from './notification-completion-proof';

export interface ImmediateOrderNotificationClaim {
  /**
   * Whether this caller won delivery ownership and must run the after()
   * notification (artifacts, DVA retry, email). False when another attempt
   * is actively delivering, already sent, or the claim RPC errored — the
   * caller must skip, never double-send.
   */
  shouldDeliver: boolean;
  /**
   * Lease token minted by the winning claim; the winner must present it
   * at completion. Null unless shouldDeliver — a missing token on a won
   * claim is treated as a skip (completing without the lease would no-op
   * and risk a duplicate send on replay).
   */
  claimToken: string | null;
  /**
   * Raw claim row status after the call (pending, processing, sent, or
   * failed); null when the call errored or returned no row. Lets
   * callers distinguish a recorded terminal status from an unlanded
   * completion without a second read.
   */
  claimStatus: string | null;
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
function parseClaimToken(row: Record<string, unknown>): string | null {
  const token = row.claim_token;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

function parseClaimStatus(row: Record<string, unknown>): string | null {
  const status = row.claim_status;
  return typeof status === 'string' && status.length > 0 ? status : null;
}

export async function claimImmediateOrderNotification(
  supabase: SupabaseClient,
  orderId: string
): Promise<ImmediateOrderNotificationClaim> {
  const skipped = { shouldDeliver: false, claimToken: null, claimStatus: null };
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
    if (!row || typeof row !== 'object') {
      return skipped;
    }
    const typedRow = row as Record<string, unknown>;
    const claimStatus = parseClaimStatus(typedRow);
    if (row.claimed !== true) {
      return { shouldDeliver: false, claimToken: null, claimStatus };
    }
    const claimToken = parseClaimToken(typedRow);
    if (!claimToken) {
      logger.error({
        message:
          'Immediate order notification claim won without a lease token; skipping delivery',
        orderId,
      });
      return skipped;
    }
    return { shouldDeliver: true, claimToken, claimStatus };
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
 * Proof-bound claim for user-facing routes (AGENTS.md: never use the
 * admin/service-role client for user-facing operations). Verifies the
 * order's creation tracking token inside the RPC before touching claim
 * state; safe on the request-scoped client. Never rejects: a failed or
 * denied proof skips delivery (logged) rather than breaking checkout.
 */
export async function claimImmediateOrderNotificationWithProof(
  supabase: SupabaseClient,
  orderId: string,
  trackingToken: string | null
): Promise<ImmediateOrderNotificationClaim> {
  const skipped = { shouldDeliver: false, claimToken: null, claimStatus: null };
  if (!trackingToken) {
    logger.error({
      message:
        'Immediate order notification proof claim skipped: missing tracking token',
      orderId,
    });
    return skipped;
  }
  try {
    const { data, error } = await supabase.rpc(
      'claim_immediate_order_notification_with_proof',
      { p_order_id: orderId, p_tracking_token: trackingToken }
    );
    if (error) {
      logger.error({
        message:
          'Immediate order notification proof claim failed; skipping delivery',
        error,
        orderId,
      });
      return skipped;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object') {
      return skipped;
    }
    const typedRow = row as Record<string, unknown>;
    const claimStatus = parseClaimStatus(typedRow);
    if (row.claimed !== true) {
      return { shouldDeliver: false, claimToken: null, claimStatus };
    }
    const claimToken = parseClaimToken(typedRow);
    if (!claimToken) {
      logger.error({
        message:
          'Immediate order notification proof claim won without a lease token; skipping delivery',
        orderId,
      });
      return skipped;
    }
    return { shouldDeliver: true, claimToken, claimStatus };
  } catch (error) {
    logger.error({
      message:
        'Immediate order notification proof claim raised; skipping delivery',
      error,
      orderId,
    });
    return skipped;
  }
}

/**
 * Proof-bound delivery completion for user-facing routes. Best-effort
 * and never-rejecting like the claim itself. The server-only HMAC
 * proof is computed inside the try: an unconfigured secret degrades
 * to a skipped completion (logged) exactly like an RPC failure —
 * never a forged proof. Returns whether the completion RPC accepted
 * the call — not whether the status recorded: the void RPC cannot
 * distinguish a no-op (unprovisioned secret) from a landed write
 * without oracling, so callers that need recorded-status must
 * re-read (sent rows are never reclaimable).
 */
export async function completeImmediateOrderNotificationWithProof(
  supabase: SupabaseClient,
  orderId: string,
  trackingToken: string | null,
  sent: boolean,
  claimToken: string | null
): Promise<boolean> {
  if (!trackingToken || !claimToken) {
    return false;
  }
  try {
    const { error } = await supabase.rpc(
      'complete_immediate_order_notification_with_proof',
      {
        p_order_id: orderId,
        p_tracking_token: trackingToken,
        p_sent: sent,
        p_claim_token: claimToken,
        p_completion_proof: createImmediateNotificationCompletionProof({
          orderId,
          claimToken,
          sent,
        }),
      }
    );
    if (error) {
      logger.error({
        message: 'Immediate order notification proof completion failed',
        error,
        orderId,
        sent,
      });
      return false;
    }
    return true;
  } catch (error) {
    logger.error({
      message: 'Immediate order notification proof completion raised',
      error,
      orderId,
      sent,
    });
    return false;
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
  sent: boolean,
  claimToken: string | null
): Promise<void> {
  if (!claimToken) {
    return;
  }
  try {
    const { error } = await supabase.rpc(
      'complete_immediate_order_notification',
      { p_order_id: orderId, p_sent: sent, p_claim_token: claimToken }
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
