import type { SupabaseClient } from '@supabase/supabase-js';
import { buildSettlementNotificationEmail } from '@/lib/build-settlement-notification-email';
import { logger } from '@/lib/logger';
import type { sendEmail } from '@/lib/zeptomail';
import { scheduleSettlementNotificationRetries } from './schedule-settlement-notification-retries';

export interface MerchantSettlementBatch {
  businessName: string;
  email: string;
  merchantId: string;
  settlements: Array<{
    amount: number;
    description: string;
    gateway: string;
    id: string;
    notificationAttempts: number;
  }>;
  totalAmount: number;
}

/**
 * Send one batched notification email for a merchant, then mark exactly
 * the rows still settled-and-unnotified so a concurrent reversal is
 * never announced twice. Returns this batch's send counts.
 *
 * Dispatch boundary: only rows with no dispatch rejoin the retry
 * queue. Once the email was sent (or may have been), a failed
 * notified mark retries once and then dead-letters — deferring would
 * resend a delivered message on the next run.
 */
export async function sendMerchantSettlementBatch({
  batch,
  sendEmail: sendSettlementEmail,
  supabase,
}: {
  batch: MerchantSettlementBatch;
  sendEmail: typeof sendEmail;
  supabase: SupabaseClient;
}): Promise<{ failed: number; sent: number }> {
  const results = { failed: 0, sent: 0 };
  // Hoisted for the catch: a throw during revalidation, email
  // preparation, or delivery must still advance these rows through
  // retry accounting, or they pin the bounded oldest-first batch on
  // every invocation. `announced` records whether a dispatch
  // happened (or may have) so the catch never requeues a delivered
  // email.
  let stillSettled: MerchantSettlementBatch['settlements'] = [];
  let announced = false;
  let uncertainDelivery = false;
  try {
    const settlementIds = batch.settlements.map((s) => s.id);

    // Revalidate immediately before sending: a concurrent refund
    // may have reversed (cancelled) a snapshotted settlement
    // after the batch read. Only settled, still-unnotified rows
    // are announced. A reversal landing between this read and the
    // send can still announce once; the guarded mark below keeps
    // the flag truthful so it never repeats.
    const { data: fresh, error: freshError } = await supabase
      .from('merchant_settlements')
      .select('id, status, settlement_notified')
      .in('id', settlementIds);
    if (freshError) throw freshError;
    const current = new Map(
      (
        (fresh ?? []) as Array<{
          id: string;
          settlement_notified: boolean;
          status: string;
        }>
      ).map((row) => [row.id, row])
    );
    stillSettled = batch.settlements.filter((item) => {
      const row = current.get(item.id);
      return row?.status === 'settled' && row.settlement_notified === false;
    });
    if (stillSettled.length === 0) return results;
    const totalAmount = stillSettled.reduce(
      (sum, item) => sum + item.amount,
      0
    );

    // ZeptoMail resolves failures instead of throwing. A
    // definite rejection (invalid recipient, exhausted provider
    // retries) stays unnotified and retryable. An uncertain
    // outcome (timeout after the provider may have accepted) must
    // NOT rejoin the retry queue — the next run could duplicate a
    // delivered message — so it marks notified below but still
    // counts failed so operations verifies actual delivery.
    const emailResult = await sendSettlementEmail(
      buildSettlementNotificationEmail({
        ...batch,
        settlements: stillSettled,
        totalAmount,
      })
    );
    uncertainDelivery =
      !emailResult.success && emailResult.deliveryOutcome === 'unknown';
    announced = emailResult.success || uncertainDelivery;
    if (!emailResult.success && !uncertainDelivery) {
      logger.error({
        message: 'Settlement notification email rejected',
        merchantId: batch.merchantId,
        error: emailResult,
      });
      // A definite rejection stays unnotified but must not rejoin
      // the head of the bounded oldest-first queue immediately.
      await scheduleSettlementNotificationRetries({
        items: stillSettled,
        logScope: { merchantId: batch.merchantId },
        reason: 'rejected',
        supabase,
      });
      results.failed++;
      return results;
    }

    // Guard the mark with the same predicates: a reversal racing
    // the send must not be flagged notified. Supabase resolves
    // write failures instead of throwing, so check the response:
    // reporting sent when the mark failed would hide the next
    // run's duplicate email behind a success signal.
    const markIds = stillSettled.map((s) => s.id);
    const markNotified = () =>
      supabase
        .from('merchant_settlements')
        .update({
          settlement_notified: true,
          notification_sent_at: new Date().toISOString(),
        })
        .eq('status', 'settled')
        .eq('settlement_notified', false)
        .in('id', markIds);
    let markError: unknown = null;
    try {
      ({ error: markError } = await markNotified());
    } catch (markThrow) {
      markError = markThrow;
    }
    if (markError) {
      // The email was delivered (or may have been): the guarded
      // update is idempotent, so retry once before giving up —
      // the common failure is a transient transport blip.
      try {
        ({ error: markError } = await markNotified());
      } catch (markThrow) {
        markError = markThrow;
      }
    }

    if (markError) {
      logger.error({
        message: 'Settlement notification delivered but unmarked',
        merchantId: batch.merchantId,
        error: markError,
      });
      // Requeueing here would resend a delivered email on the next
      // run: retire the rows from the queue instead and let
      // operations verify delivery out of band.
      await scheduleSettlementNotificationRetries({
        items: stillSettled,
        logScope: { merchantId: batch.merchantId },
        reason: 'delivered-unmarked',
        supabase,
      });
      results.failed++;
      return results;
    }

    if (uncertainDelivery) {
      // Persisted as notified so no retry duplicates a possibly
      // delivered message; failed so the run signals operations
      // to verify delivery out of band.
      logger.error({
        message: 'Settlement notification delivery uncertain',
        merchantId: batch.merchantId,
        error: emailResult,
      });
      results.failed++;
      return results;
    }

    results.sent++;
  } catch (emailError) {
    logger.error({
      message: 'Failed to send settlement notification',
      merchantId: batch.merchantId,
      error: emailError,
    });
    if (announced) {
      // Unreachable through the mark above (its throws are caught
      // for the retry), but kept explicit: if a dispatch ever
      // throws from here, the email may already be delivered and
      // requeueing would resend it — dead-letter instead.
      await scheduleSettlementNotificationRetries({
        items: stillSettled.length > 0 ? stillSettled : batch.settlements,
        logScope: { merchantId: batch.merchantId },
        reason: 'delivered-unmarked',
        supabase,
      });
      results.failed++;
      return results;
    }
    // Thrown errors are pre-dispatch (revalidation read, email
    // build, sender resolution): ZeptoMail resolves post-dispatch
    // outcomes instead of throwing (see its dispatch-boundary
    // contract), and the notified mark above catches its own
    // throws for the retry — so nothing thrown here was
    // announced, and the rows rejoin the retry queue rather than
    // pinning the batch. A throw before revalidation completed
    // falls back to the whole merchant batch; the scheduler's
    // guarded update skips rows that reversed since the batch
    // read.
    const retryItems =
      stillSettled.length > 0 ? stillSettled : batch.settlements;
    await scheduleSettlementNotificationRetries({
      items: retryItems,
      logScope: { merchantId: batch.merchantId },
      reason: 'error',
      supabase,
    });
    results.failed++;
  }
  return results;
}
