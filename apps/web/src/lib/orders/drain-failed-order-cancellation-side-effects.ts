import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { ORDER_WITH_ITEMS_QUERY } from '@/lib/order-queries';
import { executeOrderCancellationSideEffect } from '@/lib/orders/execute-order-cancellation-side-effect';
import type { CancellationEmailSender } from '@/lib/orders/order-cancellation-side-effect-types';
import {
  type OrderCancellationSideEffectStep,
  runOrderCancellationSideEffect,
} from '@/lib/orders/run-order-cancellation-side-effect';

const DEFAULT_LIMIT = 10;
const MAX_ATTEMPTS = 5;
const STALE_CLAIM_MINUTES = 15;

interface CandidateRow {
  claimed_at: string;
  order_id: string;
  step: OrderCancellationSideEffectStep;
}

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
  limit = DEFAULT_LIMIT,
  sendCancellationEmail,
}: {
  supabase: SupabaseClient;
  deadlineMs?: number;
  limit?: number;
  sendCancellationEmail: CancellationEmailSender;
}): Promise<CancellationSideEffectDrainSummary> {
  const summary: CancellationSideEffectDrainSummary = {
    drained: [],
    failed: [],
    skipped: [],
  };
  const select = 'order_id, step, claimed_at';
  const { data: failedRows, error: failedLookupError } = await supabase
    .from('order_cancellation_side_effects')
    .select(select)
    .eq('status', 'failed')
    .lt('attempts', MAX_ATTEMPTS)
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

  for (const raw of staleRows ?? []) {
    const stale = raw as CandidateRow;
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
    const reason = quarantineError
      ? 'stale_claim_quarantine_failed'
      : 'stale_claim_delivery_uncertain';
    const target = quarantineError ? summary.failed : summary.skipped;
    target.push({ orderId: stale.order_id, reason, step: stale.step });
  }

  const candidates = new Map<string, CandidateRow>();
  for (const row of failedRows ?? []) {
    const candidate = row as CandidateRow;
    candidates.set(`${candidate.order_id}:${candidate.step}`, candidate);
    if (candidates.size >= limit) break;
  }

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

      const status = await runOrderCancellationSideEffect({
        orderId,
        step,
        supabase,
        execute: () =>
          executeOrderCancellationSideEffect({
            deadlineMs,
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
