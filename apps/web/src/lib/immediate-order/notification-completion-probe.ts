import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { claimImmediateOrderNotificationWithProof } from './notification-claim';
import { createImmediateNotificationCompletionProof } from './notification-completion-proof';

export interface ImmediateNotificationCompletionProbe {
  /**
   * True when the completion HMAC secret is provisioned AND this caller
   * still owns delivery (fresh lease in claimToken). False when the
   * secret stays unprovisioned past the retry budget (or the probe
   * errored): the caller must skip the send without completing — the
   * never-started claim expires on its short grace and a later replay
   * resumes delivery.
   */
  provisioned: boolean;
  /** Fresh lease minted by the probe's reclaim; null unless provisioned. */
  claimToken: string | null;
}

export interface ProbeCompletionProvisioningOptions {
  /**
   * Release/reclaim rounds before giving up. Default covers the
   * migration-to-first-provision-cron window (eleven rounds at the
   * default delay span five minutes).
   */
  maxAttempts?: number;
  /** Delay between rounds. Defaults to 30 seconds. */
  retryDelayMs?: number;
  /** Injectable wait (tests pass a synchronous stub). */
  sleep?: (ms: number) => Promise<unknown>;
}

const DEFAULT_MAX_ATTEMPTS = 11;
const DEFAULT_RETRY_DELAY_MS = 30_000;

const defaultSleep = (ms: number): Promise<unknown> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Probes whether the completion HMAC secret is provisioned before
 * after() sends, retrying across the provisioning window. Each round
 * releases our own fresh claim through the proof-bound failed path,
 * then immediately reclaims it: a provisioned secret releases failed
 * claims instantly, so the reclaim re-wins with a fresh lease; an
 * unprovisioned secret no-ops the release, so our own fresh lock
 * blocks the reclaim and the round observably loses. No new RPC or
 * oracle surface — the verdict comes from the existing claim/complete
 * protocol. Never rejects: any probe failure reads as unprovisioned
 * (delivery deferred to replay, never sent uncompletable). An
 * unconfigured server secret throws inside the proof helper on the
 * first round, so deploy misconfiguration fails fast without burning
 * the retry budget.
 */
export async function probeImmediateNotificationCompletionProvisioned(
  supabase: SupabaseClient,
  orderId: string,
  trackingToken: string | null,
  claimToken: string | null,
  options: ProbeCompletionProvisioningOptions = {}
): Promise<ImmediateNotificationCompletionProbe> {
  const unprovisioned = { provisioned: false, claimToken: null };
  if (!trackingToken || !claimToken) {
    return unprovisioned;
  }
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  let proof: string;
  try {
    proof = createImmediateNotificationCompletionProof({
      orderId,
      claimToken,
      sent: false,
    });
  } catch (error) {
    logger.error({
      message:
        'Immediate order notification completion secret unavailable; deferring delivery to replay',
      error,
      orderId,
    });
    return unprovisioned;
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let released = false;
    try {
      const { error } = await supabase.rpc(
        'complete_immediate_order_notification_with_proof',
        {
          p_order_id: orderId,
          p_tracking_token: trackingToken,
          p_sent: false,
          p_claim_token: claimToken,
          p_completion_proof: proof,
        }
      );
      released = !error;
      if (error) {
        logger.error({
          message:
            'Immediate order notification provisioning probe failed; retrying within budget',
          error,
          orderId,
        });
      }
    } catch (error) {
      logger.error({
        message:
          'Immediate order notification provisioning probe raised; retrying within budget',
        error,
        orderId,
      });
    }
    if (released) {
      const reclaim = await claimImmediateOrderNotificationWithProof(
        supabase,
        orderId,
        trackingToken
      );
      if (reclaim.shouldDeliver && reclaim.claimToken) {
        return { provisioned: true, claimToken: reclaim.claimToken };
      }
    }
    if (attempt < maxAttempts) {
      logger.warn({
        message:
          'Immediate order notification completion secret not yet provisioned; retrying probe',
        orderId,
      });
      await sleep(retryDelayMs);
    }
  }
  logger.warn({
    message:
      'Immediate order notification completion secret unprovisioned; deferring delivery to replay',
    orderId,
  });
  return unprovisioned;
}
