import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  claimImmediateOrderNotificationWithProof,
  completeImmediateOrderNotificationWithProof,
} from './notification-claim';
import { createImmediateNotificationCompletionProof } from './notification-completion-proof';

export interface CompletionRetryOptions {
  /**
   * Complete/check rounds before giving up. Bounded to fit the
   * orders route's maxDuration = 60 (three rounds at the default
   * delay span ~30 seconds plus RPC time): a longer loop would be
   * terminated mid-budget without emitting its exhaustion alert.
   */
  maxAttempts?: number;
  /** Delay between rounds. Defaults to 15 seconds. */
  retryDelayMs?: number;
  /** Injectable wait (tests pass a synchronous stub). */
  sleep?: (ms: number) => Promise<unknown>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 15_000;

const defaultSleep = (ms: number): Promise<unknown> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Records the terminal claim status, retrying across HMAC
 * provisioning outages until the status is observably recorded. The
 * completion RPC returns void by design (a boolean would oracle the
 * server secret to anon callers), so each sent round completes and
 * then re-reads the claim: only the recorded sent status counts as
 * landed (sent rows are never reclaimable, so the check cannot
 * disturb them). A re-won lease (stale expiry mid-retry) is adopted
 * for the next round. Failed outcomes complete exactly once with no
 * status check: the check itself would reclaim the failed row it is
 * looking for, looping forever and leaving processing instead of
 * the immediately-retryable failed state. Never rejects: exhaustion
 * returns completed false with an alert-worthy error (the email was
 * already sent for sent outcomes, so the stuck bookkeeping needs
 * operator attention). An unconfigured server secret throws inside
 * the proof helper on the first round, failing fast without burning
 * the retry budget.
 */
export async function completeNotificationWithProvisioningRetry(
  supabase: SupabaseClient,
  orderId: string,
  trackingToken: string | null,
  sent: boolean,
  claimToken: string | null,
  options: CompletionRetryOptions = {}
): Promise<{ completed: boolean }> {
  if (!trackingToken || !claimToken) {
    return { completed: false };
  }
  if (!sent) {
    // Failed releases the claim for replay; a status check here
    // would reclaim the failed row it is looking for (failed rows
    // are immediately reclaimable), so complete once and report
    // whether the RPC accepted the call. A transport failure
    // reports uncompleted (the row stays processing for the
    // stale-window reclaim); an accepted no-op (unprovisioned)
    // simply keeps the never-started grace before the same outcome.
    const accepted = await completeImmediateOrderNotificationWithProof(
      supabase,
      orderId,
      trackingToken,
      false,
      claimToken
    );
    return { completed: accepted };
  }
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  let lease: string | null = claimToken;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      createImmediateNotificationCompletionProof({
        orderId,
        claimToken: lease,
        sent,
      });
    } catch (error) {
      logger.error({
        message:
          'Immediate order notification completion secret unavailable; terminal status unrecorded',
        error,
        orderId,
        sent,
      });
      return { completed: false };
    }
    await completeImmediateOrderNotificationWithProof(
      supabase,
      orderId,
      trackingToken,
      sent,
      lease
    );
    const check = await claimImmediateOrderNotificationWithProof(
      supabase,
      orderId,
      trackingToken
    );
    if (check.claimStatus === 'sent') {
      return { completed: true };
    }
    if (check.shouldDeliver && check.claimToken) {
      lease = check.claimToken;
    }
    if (attempt < maxAttempts) {
      logger.warn({
        message:
          'Immediate order notification completion not yet recorded; retrying within budget',
        orderId,
        sent,
      });
      await sleep(retryDelayMs);
    }
  }
  logger.error({
    message:
      'Immediate order notification completion unrecorded after retries; terminal status stuck',
    orderId,
    sent,
  });
  return { completed: false };
}
