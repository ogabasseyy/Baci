import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

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
