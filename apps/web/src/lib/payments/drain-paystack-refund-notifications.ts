import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  countDeadLetteredPaystackRefundNotifications,
  countUnresolvedUncertainRefundNotifications,
} from './count-dead-lettered-paystack-refund-notifications';
import {
  type ClaimedRefundNotification,
  deliverClaimedRefundNotification,
  type MerchantRefundPushSender,
  type RefundEmailSender,
} from './deliver-claimed-refund-notification';

export type { MerchantRefundPushSender, RefundEmailSender };

interface NotificationRow extends ClaimedRefundNotification {}

export async function drainPaystackRefundNotifications(
  supabase: SupabaseClient,
  sendEmail: RefundEmailSender,
  limit = 20,
  sendMerchantPush?: MerchantRefundPushSender,
  deadlineMs?: number
): Promise<{
  claimed: number;
  sent: number;
  failed: number;
  exhausted: number;
  uncertain: number;
}> {
  let claimed = 0;
  let sent = 0;
  let failed = 0;
  // Count dead letters even when no send can be admitted: with a zero
  // budget the claim loop below never runs, but existing exhausted or
  // stale-claimed rows are still permanently undeliverable and the
  // caller surfaces this count in its warn log and success payload.
  // Gating the count on the budget would report them as exhausted: 0
  // and return success while notifications rot.
  const exhausted =
    await countDeadLetteredPaystackRefundNotifications(supabase);
  // Terminal rows the claim already moved out of every signal: keep
  // them visible in logs and payload without joining the
  // 503-triggering exhausted count (see the counter's rationale).
  const uncertain = await countUnresolvedUncertainRefundNotifications(supabase);
  // Claim serially so a route timeout cannot strand an unsent batch.
  for (let remaining = limit; remaining > 0; remaining -= 1) {
    // Reserve time for the provider call and outcome write. Rows the
    // post-claim admission check then refuses are released back to
    // pending without burning the attempt (see the deferred finish
    // below), so this reserve stays a pure efficiency backstop rather
    // than a second admission gate that would starve smaller rows.
    if (deadlineMs !== undefined && deadlineMs - Date.now() < 45_000) break;
    const { data, error } = await supabase.rpc(
      'claim_paystack_cancellation_refund_notifications_v1',
      { p_limit: 1 }
    );
    if (error) throw new Error('refund_notification_claim_failed');
    const [row] = (data ?? []) as NotificationRow[];
    if (!row) break;
    claimed += 1;
    const { lastError, outcome } = await deliverClaimedRefundNotification({
      deadlineMs,
      row,
      sendEmail,
      sendMerchantPush,
      supabase,
    });
    // A failure recorded mid-claim bumps the generation: concluding
    // on the stale read would lose the fresh contradiction, so the
    // finish is generation-pinned and a miss requeues instead.
    // A deferred row was never attempted: release it back to pending
    // and un-burn the attempt the claim just added (the returned row
    // already includes the increment), so five tight-budget ticks
    // cannot dead-letter a healthy notification without ever sending
    // it. The fresh claimed_at backs the row off, so the loop cannot
    // reclaim it into a spin.
    const persistFinish = () =>
      supabase
        .from('paystack_cancellation_refund_notifications')
        .update(
          outcome === 'deferred'
            ? {
                status: 'pending',
                attempts: Math.max(0, row.attempts - 1),
                last_error: lastError,
              }
            : {
                status: outcome,
                last_error: lastError,
                sent_at: outcome === 'sent' ? new Date().toISOString() : null,
              }
        )
        .eq('id', row.id)
        .eq('claim_token', row.claim_token)
        .eq('status', 'processing')
        .eq('generation', row.generation)
        .select('id')
        .maybeSingle();
    const parkUncertain = () =>
      supabase
        .from('paystack_cancellation_refund_notifications')
        .update({
          status: 'delivery_uncertain',
          last_error: 'refund_notification_finish_unconfirmed',
        })
        .eq('id', row.id)
        .eq('claim_token', row.claim_token)
        .eq('status', 'processing')
        .select('id')
        .maybeSingle();
    // Restore a deferred row's pending release after a failed finish
    // write. Deferred rows never attempted delivery, so re-releasing
    // cannot double-send — but only on a proven state read, never
    // blindly. Returns false when the row is no longer releasable,
    // leaving it processing for the stale-claim sweep.
    const recoverDeferredRelease = async (): Promise<boolean> => {
      const { data: refetched, error: refetchError } = await supabase
        .from('paystack_cancellation_refund_notifications')
        .select('status, claim_token')
        .eq('id', row.id)
        .maybeSingle();
      if (refetchError) return false;
      const current = (refetched ?? null) as {
        claim_token?: unknown;
        status?: unknown;
      } | null;
      // The release landed unseen: nothing left to do.
      if (current?.status === 'pending') return true;
      if (
        current?.status !== 'processing' ||
        current?.claim_token !== row.claim_token
      )
        return false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const retry = await persistFinish();
        if (!retry.error && retry.data) return true;
      }
      return false;
    };
    let finish = await persistFinish();
    if (finish.error) {
      // A database error is not a generation mismatch: the attempt
      // may have persisted unseen, so retry the known outcome once
      // instead of requeueing (a requeue would double-send).
      finish = await persistFinish();
    }
    if (finish.error || !finish.data) {
      // A deferred row never attempted delivery, so restoring its
      // pending release is always safe — and parking it uncertain
      // would terminalize a healthy row for a transient write blip.
      if (outcome === 'deferred' && (await recoverDeferredRelease())) continue;
      if (!finish.error) {
        // No error, no row: the generation predicate rejected the
        // write. Re-read the row and requeue only on a proven race
        // — our claim still held with a strictly newer generation.
        const { data: refetched, error: refetchError } = await supabase
          .from('paystack_cancellation_refund_notifications')
          .select('status, claim_token, generation')
          .eq('id', row.id)
          .maybeSingle();
        const current = (refetched ?? null) as {
          claim_token?: unknown;
          generation?: unknown;
          status?: unknown;
        } | null;
        const raceProven =
          !refetchError &&
          current?.status === 'processing' &&
          current?.claim_token === row.claim_token &&
          typeof current?.generation === 'number' &&
          current.generation > row.generation;
        if (raceProven) {
          const { data: requeued, error: requeueError } = await supabase
            .from('paystack_cancellation_refund_notifications')
            .update({
              status: 'pending',
              claimed_at: null,
              claim_token: null,
              last_error: null,
              // The proven newer generation is a fresh notification, not
              // a retry of the concluded one: reset its budget, or the
              // claim RPC's exhausted-CTE dead-letters it (attempts >= 5
              // is never claimable) and the new failure alert is lost.
              attempts: 0,
            })
            .eq('id', row.id)
            .eq('claim_token', row.claim_token)
            .eq('status', 'processing')
            // Bind the requeue to the proven bump: a concurrent
            // finisher concluding on the newer generation must not be
            // resurrected into pending.
            .gt('generation', row.generation)
            .select('id')
            .maybeSingle();
          if (!requeueError && requeued) {
            logger.info({
              message:
                'Refund notification requeued: fresh failures arrived during its claim',
              notificationId: row.id,
            });
            continue;
          }
        }
      }
      if (outcome === 'deferred') {
        // Release failed and no race to requeue: never park a
        // never-attempted row uncertain — leave it processing for the
        // stale-claim sweep (15-minute backstop with an ops-visible
        // error) instead of terminalizing a healthy row.
        logger.error({
          message:
            'Refund notification deferred release could not be persisted',
          notificationId: row.id,
        });
        failed++;
        continue;
      }
      // Unproven race or failed retry: never requeue — the finish
      // may have persisted unseen, and a second sweep would re-send.
      // Park an owned row as delivery_uncertain instead: the status
      // guard leaves a persisted finish untouched.
      await parkUncertain();
      logger.error({
        message: 'Refund notification delivery outcome could not be persisted',
        notificationId: row.id,
      });
      failed++;
      continue;
    }
    // A deferred row was released unattempted: it counts as claimed
    // work but neither sent nor failed, so tight budgets do not read
    // as delivery failures.
    if (outcome === 'sent') sent++;
    else if (outcome !== 'deferred') failed++;
  }
  return { claimed, sent, failed, exhausted, uncertain };
}
