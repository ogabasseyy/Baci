import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { ORDER_WITH_ITEMS_QUERY } from '@/lib/order-queries';
import { CANCELLATION_EMAIL_CLAIM_WRITE_ALLOWANCE_MS } from '@/lib/orders/cancellation-drain-deadline';
import { EMAIL_ATTEMPTS_PER_SENDER } from '@/lib/orders/execute-customer-email-cancellation-side-effect';
import { executeOrderCancellationSideEffect } from '@/lib/orders/execute-order-cancellation-side-effect';
import type { CancellationEmailSender } from '@/lib/orders/order-cancellation-side-effect-types';
import {
  type OrderCancellationSideEffectStep,
  runOrderCancellationSideEffect,
} from '@/lib/orders/run-order-cancellation-side-effect';
import {
  type CancellationDrainCandidateRow,
  selectCancellationDrainCandidates,
} from '@/lib/orders/select-cancellation-drain-candidates';
import { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail-send-budget';

const DEFAULT_LIMIT = 10;
const MAX_ATTEMPTS = 5;
const STALE_CLAIM_MINUTES = 15;

export interface CancellationSideEffectDrainSummary {
  drained: Array<{ orderId: string; step: OrderCancellationSideEffectStep }>;
  failed: Array<{
    orderId: string;
    reason: string;
    step: OrderCancellationSideEffectStep;
  }>;
  skipped: Array<{
    orderId: string;
    reason: string;
    step: OrderCancellationSideEffectStep;
  }>;
}

const MERCHANT_SELECT =
  'id, business_name, slug, support_email, email_sender_name, email, tax_identification_number, cac_rc_number';

export async function drainFailedOrderCancellationSideEffects({
  supabase,
  deadlineMs,
  emailDeadlineMs,
  limit = DEFAULT_LIMIT,
  sendCancellationEmail,
}: {
  supabase: SupabaseClient;
  deadlineMs?: number;
  emailDeadlineMs?: number;
  limit?: number;
  sendCancellationEmail: CancellationEmailSender;
}): Promise<CancellationSideEffectDrainSummary> {
  const summary: CancellationSideEffectDrainSummary = {
    drained: [],
    failed: [],
    skipped: [],
  };
  const select = 'order_id, step, claimed_at, attempts';
  // Emails admit against their own later cutoff: the side-effect
  // deadline leaves no room after a full reconcile phase. Callers
  // that pass none keep the legacy shared-deadline behavior.
  const emailCutoff = emailDeadlineMs ?? deadlineMs;
  // When the email admission budget is already short, customer_email rows
  // can never be admitted this run — yet the SQL limit counts them, so a
  // limit-1 fetch returning only an old email starves the refund behind
  // it on every invocation. Exclude them from the fetch so
  // budget-eligible rows fill the batch; the fill-loop filter and the
  // per-row backstop stay for budget that burns out mid-run.
  const emailAdmissionShort =
    emailCutoff !== undefined &&
    emailCutoff - Date.now() <
      zeptomailSendAdmissionBudgetMs(EMAIL_ATTEMPTS_PER_SENDER);
  const failedFetch = supabase
    .from('order_cancellation_side_effects')
    .select(select)
    .eq('status', 'failed')
    .lt('attempts', MAX_ATTEMPTS);
  if (emailAdmissionShort) {
    failedFetch.neq('step', 'customer_email');
  }
  const { data: failedRows, error: failedLookupError } = await failedFetch
    .order('claimed_at', { ascending: true })
    .limit(limit);
  if (failedLookupError) {
    throw new Error(
      `cancellation_side_effect_lookup_failed: ${failedLookupError.message}`
    );
  }

  const staleClaimCutoff = new Date(
    Date.now() - STALE_CLAIM_MINUTES * 60_000
  ).toISOString();
  const { data: staleRows, error: staleLookupError } = await supabase
    .from('order_cancellation_side_effects')
    .select(select)
    .eq('status', 'claimed')
    .lt('claimed_at', staleClaimCutoff)
    .order('claimed_at', { ascending: true })
    .limit(limit);
  if (staleLookupError) {
    throw new Error(
      `stale_cancellation_side_effect_lookup_failed: ${staleLookupError.message}`
    );
  }

  // Deferred rows wait on provider reconciliation, not on retries: reselect
  // them without the attempts cap so a pending refund that completes late
  // still resumes its remaining legs. The claim RPC never increments
  // attempts for deferred rows, so this cannot spin the retry budget.
  const deferredFetch = supabase
    .from('order_cancellation_side_effects')
    .select(select)
    .eq('status', 'deferred');
  if (emailAdmissionShort) {
    deferredFetch.neq('step', 'customer_email');
  }
  const { data: deferredRows, error: deferredLookupError } = await deferredFetch
    .order('claimed_at', { ascending: true })
    .limit(limit);
  if (deferredLookupError) {
    throw new Error(
      `deferred_cancellation_side_effect_lookup_failed: ${deferredLookupError.message}`
    );
  }

  for (const raw of staleRows ?? []) {
    const stale = raw as CancellationDrainCandidateRow;
    const { error: quarantineError } = await supabase
      .from('order_cancellation_side_effects')
      .update({
        error:
          'Claim expired before completion; delivery requires reconciliation',
        status: 'delivery_uncertain',
      })
      .eq('order_id', stale.order_id)
      .eq('step', stale.step)
      .eq('status', 'claimed')
      .eq('claimed_at', stale.claimed_at);
    // A terminalized stale claim is a failure, not benign skipped work:
    // the refund may have been accepted without a persisted outcome and
    // the row will never run again, so the route must surface it in its
    // non-2xx health signal instead of reporting success.
    const reason = quarantineError
      ? 'stale_claim_quarantine_failed'
      : 'stale_claim_delivery_uncertain';
    summary.failed.push({ orderId: stale.order_id, reason, step: stale.step });
  }

  const candidates = selectCancellationDrainCandidates({
    deadlineMs,
    deferredRows: (deferredRows ?? []) as CancellationDrainCandidateRow[],
    emailDeadlineMs,
    failedRows: (failedRows ?? []) as CancellationDrainCandidateRow[],
    limit,
    maxAttempts: MAX_ATTEMPTS,
  });

  for (const candidate of candidates.values()) {
    const { order_id: orderId, step } = candidate;
    // A refund step can outlast the fixed per-step estimate (multiple
    // serial provider calls), so stop starting work once the invocation
    // deadline passes instead of claiming a row the abort would strand.
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
      logger.info({
        message: 'Stopping cancellation side-effect drain at cron deadline',
        orderId,
        step,
      });
      break;
    }
    // A customer-email step admitted without its sender budget would
    // claim (burning an attempt) only to refuse before sending; under
    // a sustained backlog five such budget-only failures would cap the
    // row and the email would never send. Skip it unclaimed so it stays
    // failed for a tick with room. Later refund steps still run.
    if (
      step === 'customer_email' &&
      emailCutoff !== undefined &&
      emailCutoff - Date.now() <
        zeptomailSendAdmissionBudgetMs(EMAIL_ATTEMPTS_PER_SENDER)
    ) {
      logger.info({
        message:
          'Skipping cancellation email without claiming: too little budget remains to send',
        orderId,
        step,
      });
      continue;
    }
    try {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select(`${ORDER_WITH_ITEMS_QUERY}, cancelled_at, cancellation_reason`)
        .eq('id', orderId)
        .single();
      if (orderError || !order) {
        summary.failed.push({ orderId, reason: 'order_lookup_failed', step });
        continue;
      }

      const { data: merchant, error: merchantError } = await supabase
        .from('merchants')
        .select(MERCHANT_SELECT)
        .eq('id', order.merchant_id)
        .single();
      if (merchantError || !merchant) {
        summary.failed.push({
          orderId,
          reason: 'merchant_lookup_failed',
          step,
        });
        continue;
      }

      // The order/merchant reads above can burn the margin the pre-read
      // backstop approved: without this recheck the claim below would
      // increment attempts and the executor would then fail its own
      // admission check without sending, capping the row after five
      // budget-only failures. Skip unclaimed while the send plus the
      // claim write no longer fits.
      if (
        step === 'customer_email' &&
        emailCutoff !== undefined &&
        emailCutoff - Date.now() <
          zeptomailSendAdmissionBudgetMs(EMAIL_ATTEMPTS_PER_SENDER) +
            CANCELLATION_EMAIL_CLAIM_WRITE_ALLOWANCE_MS
      ) {
        logger.info({
          message:
            'Skipping cancellation email without claiming: lookups consumed the send budget',
          orderId,
          step,
        });
        continue;
      }

      const status = await runOrderCancellationSideEffect({
        orderId,
        step,
        supabase,
        execute: () =>
          executeOrderCancellationSideEffect({
            deadlineMs: step === 'customer_email' ? emailCutoff : deadlineMs,
            isLastAttempt: candidate.isLastAttempt,
            merchant,
            order,
            reason: order.cancellation_reason ?? undefined,
            sendCancellationEmail,
            step,
            supabase,
          }),
      });
      if (status === 'completed') {
        summary.drained.push({ orderId, step });
      } else if (status === 'deferred') {
        summary.skipped.push({ orderId, reason: status, step });
      } else {
        summary.failed.push({ orderId, reason: status, step });
      }
    } catch (error) {
      logger.error({
        error,
        message: 'Cancellation side-effect drain errored',
        orderId,
        step,
      });
      summary.failed.push({ orderId, reason: 'drain_error', step });
    }
  }

  return summary;
}
