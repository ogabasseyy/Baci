import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { verifyTransaction } from '@/lib/paystack';
import type { finalizeOrderGatewayPayment } from './finalize-order-gateway-payment';
import { normalizePaymentGateway } from './normalize-payment-gateway';
import { processAbandonedPaystackAttempt } from './reconcile-abandoned-paystack-attempts-process';

const DEFAULT_LIMIT = 25;
// Give an abandoned checkout time to settle before releasing a paid order.
const DEFAULT_OLDER_THAN_MINUTES = 12 * 60;
const RECHECK_AFTER_MINUTES = 55;

interface PendingAttempt {
  amount: number;
  currency: string;
  gateway: string | null;
  gateway_reference: string;
  id: string;
  merchant_id: string;
  metadata: Record<string, unknown> | null;
  order_id: string;
  paid_order?: { payment_status: string } | Array<{ payment_status: string }>;
  platform_fee: number | null;
  status: 'pending' | 'processing' | 'completed';
}

export interface AbandonedPaystackAttemptSummary {
  checked: number;
  completed: string[];
  failed: boolean;
  held: Array<{ id: string; reason: string; rotationFailed?: boolean }>;
  retired: string[];
  reviewsFiled: string[];
}

/** Clear old, superseded attempts only after checking their current Paystack status. */
export async function reconcileAbandonedPaystackAttempts({
  supabase,
  finalizePayment,
  verify = verifyTransaction,
  limit = DEFAULT_LIMIT,
  olderThanMinutes = DEFAULT_OLDER_THAN_MINUTES,
  deadlineMs,
  scheduleAfter = () => {
    // No-op default for unit tests; the cron route passes after().
  },
}: {
  supabase: SupabaseClient;
  finalizePayment?: typeof finalizeOrderGatewayPayment;
  verify?: typeof verifyTransaction;
  limit?: number;
  olderThanMinutes?: number;
  deadlineMs?: number;
  scheduleAfter?: (task: () => Promise<void>) => void;
}): Promise<AbandonedPaystackAttemptSummary> {
  const summary: AbandonedPaystackAttemptSummary = {
    checked: 0,
    completed: [],
    failed: false,
    held: [],
    retired: [],
    reviewsFiled: [],
  };
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const recheckCutoff = new Date(
    Date.now() - RECHECK_AFTER_MINUTES * 60_000
  ).toISOString();
  // Millis-free stamps for the or() filters below: fractional seconds
  // would inject dots the OR parser reads as condition separators.
  const orCutoff = `${cutoff.split('.')[0]}Z`;
  const orRecheckCutoff = `${recheckCutoff.split('.')[0]}Z`;
  // Legacy rows may pad or re-case the gateway (` Paystack `) while
  // cancellation still treats them as in-flight captures: prefilter
  // case-insensitively server-side, then exact-normalize below.
  const { data: mainAttempts, error: lookupError } = await supabase
    .from('transactions')
    .select(
      'id, order_id, merchant_id, gateway, gateway_reference, amount, currency, status, metadata, platform_fee, paid_order:orders!transactions_order_id_fkey!inner(payment_status)'
    )
    .eq('transaction_type', 'payment')
    .ilike('gateway', '%paystack%')
    .in('status', ['pending', 'processing'])
    .in('paid_order.payment_status', ['paid', 'partially_paid'])
    .not('order_id', 'is', null)
    .not('gateway_reference', 'is', null)
    .is('metadata->abandoned_sweep_resolution', null)
    // The schema permits null timestamps, and plain < comparisons
    // exclude legacy/imported rows forever — leaving them pending
    // while cancellation keeps rejecting the order as in-flight. A
    // missing timestamp is the stalest possible signal, so nulls
    // stay eligible for reconciliation.
    .or(`created_at.lt.${orCutoff},created_at.is.null`)
    .or(`updated_at.lt.${orRecheckCutoff},updated_at.is.null`)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (lookupError) {
    throw new Error(
      `pending_paystack_attempt_lookup_failed: ${lookupError.message}`
    );
  }

  // Filing-only retries: completed captures whose duplicate filings
  // both failed carry the retry marker. Unstamped only, and never on
  // partially-paid orders — a completed row must not re-enter the
  // partial-payment finalizer.
  const { data: pendingRetries, error: pendingError } = await supabase
    .from('transactions')
    .select(
      'id, order_id, merchant_id, gateway, gateway_reference, amount, currency, status, metadata, platform_fee, paid_order:orders!transactions_order_id_fkey!inner(payment_status)'
    )
    .eq('transaction_type', 'payment')
    .ilike('gateway', '%paystack%')
    .eq('status', 'completed')
    .neq('paid_order.payment_status', 'partially_paid')
    .not('order_id', 'is', null)
    .not('gateway_reference', 'is', null)
    .is('metadata->abandoned_sweep_resolution', null)
    .eq('metadata->>duplicate_capture_review_pending', 'true')
    .or(`created_at.lt.${orCutoff},created_at.is.null`)
    .or(`updated_at.lt.${orRecheckCutoff},updated_at.is.null`)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (pendingError) {
    throw new Error(
      `pending_paystack_attempt_lookup_failed: ${pendingError.message}`
    );
  }

  // The ilike prefilter is deliberately loose (casing, padding):
  // exact-normalize here so only genuine Paystack legs verify.
  const attempts = [...(mainAttempts ?? []), ...(pendingRetries ?? [])].filter(
    (attempt) =>
      normalizePaymentGateway((attempt as PendingAttempt).gateway) ===
      'PAYSTACK'
  );

  for (const attempt of attempts as PendingAttempt[]) {
    // Stop starting attempts at the pass deadline: serial provider
    // verification can outlast the invocation budget, and unstarted rows
    // stay eligible for the next sweep.
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
      logger.info({
        message: 'Stopping abandoned-attempt sweep at pass deadline',
        attemptId: attempt.id,
      });
      break;
    }
    summary.checked += 1;
    await processAbandonedPaystackAttempt(supabase, attempt, {
      deadlineMs,
      finalizePayment,
      scheduleAfter,
      summary,
      verify,
    });
  }

  return summary;
}
