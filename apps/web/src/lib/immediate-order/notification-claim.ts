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

export async function claimImmediateOrderNotification(
  supabase: SupabaseClient,
  orderId: string
): Promise<ImmediateOrderNotificationClaim> {
  const skipped = { shouldDeliver: false, claimToken: null };
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
    const claimToken = parseClaimToken(row as Record<string, unknown>);
    if (!claimToken) {
      logger.error({
        message:
          'Immediate order notification claim won without a lease token; skipping delivery',
        orderId,
      });
      return skipped;
    }
    return { shouldDeliver: true, claimToken };
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
  const skipped = { shouldDeliver: false, claimToken: null };
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
    if (!row || typeof row !== 'object' || row.claimed !== true) {
      return skipped;
    }
    const claimToken = parseClaimToken(row as Record<string, unknown>);
    if (!claimToken) {
      logger.error({
        message:
          'Immediate order notification proof claim won without a lease token; skipping delivery',
        orderId,
      });
      return skipped;
    }
    return { shouldDeliver: true, claimToken };
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
 * Flags a won claim as started (the after() callback began running):
 * extends the claim to the full 5-minute crash window. Returns false
 * when the lease is already lost (claim rotated underneath us) or the
 * marker errors — delivery still proceeds (completion stays
 * lease-fenced), but the claim keeps the short never-started grace.
 * Never rejects.
 */
export async function markImmediateOrderNotificationStarted(
  supabase: SupabaseClient,
  orderId: string,
  claimToken: string | null
): Promise<boolean> {
  if (!claimToken) {
    return false;
  }
  try {
    const { data, error } = await supabase.rpc(
      'mark_immediate_order_notification_started',
      { p_order_id: orderId, p_claim_token: claimToken }
    );
    if (error) {
      logger.error({
        message: 'Immediate order notification start marker failed',
        error,
        orderId,
      });
      return false;
    }
    return data === true;
  } catch (error) {
    logger.error({
      message: 'Immediate order notification start marker raised',
      error,
      orderId,
    });
    return false;
  }
}

/**
 * Proof-bound start marker for user-facing routes (AGENTS.md: never the
 * admin client for user-facing operations). Never rejects like the
 * claim itself.
 */
export async function markImmediateOrderNotificationStartedWithProof(
  supabase: SupabaseClient,
  orderId: string,
  trackingToken: string | null,
  claimToken: string | null
): Promise<boolean> {
  if (!trackingToken || !claimToken) {
    return false;
  }
  try {
    const { data, error } = await supabase.rpc(
      'mark_immediate_order_notification_started_with_proof',
      {
        p_order_id: orderId,
        p_tracking_token: trackingToken,
        p_claim_token: claimToken,
      }
    );
    if (error) {
      logger.error({
        message: 'Immediate order notification proof start marker failed',
        error,
        orderId,
      });
      return false;
    }
    return data === true;
  } catch (error) {
    logger.error({
      message: 'Immediate order notification proof start marker raised',
      error,
      orderId,
    });
    return false;
  }
}

/**
 * Proof-bound delivery completion for user-facing routes. Best-effort
 * and never-rejecting like the claim itself. The server-only HMAC
 * proof is computed inside the try: an unconfigured secret degrades
 * to a skipped completion (logged) exactly like an RPC failure —
 * never a forged proof.
 */
export async function completeImmediateOrderNotificationWithProof(
  supabase: SupabaseClient,
  orderId: string,
  trackingToken: string | null,
  sent: boolean,
  claimToken: string | null
): Promise<void> {
  if (!trackingToken || !claimToken) {
    return;
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
    }
  } catch (error) {
    logger.error({
      message: 'Immediate order notification proof completion raised',
      error,
      orderId,
      sent,
    });
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
