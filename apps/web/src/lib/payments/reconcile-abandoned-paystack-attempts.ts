import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { verifyTransaction } from '@/lib/paystack';
import { fileInvalidAttemptReference } from './file-invalid-attempt-reference';
import { resolveAbandonedAttemptMismatch } from './resolve-abandoned-attempt-mismatch';
import { resolveVerifiedAbandonedAttemptCapture } from './resolve-verified-abandoned-attempt-capture';

const DEFAULT_LIMIT = 25;
// Give an abandoned checkout time to settle before releasing a paid order.
const DEFAULT_OLDER_THAN_MINUTES = 12 * 60;
const RECHECK_AFTER_MINUTES = 55;
const VERIFY_TIMEOUT_MS = 5_000;

interface PendingAttempt {
  amount: number;
  currency: string;
  gateway_reference: string;
  id: string;
  merchant_id: string;
  metadata: Record<string, unknown> | null;
  order_id: string;
  paid_order?: { payment_status: string } | Array<{ payment_status: string }>;
  platform_fee: number | null;
  status: 'pending' | 'processing';
}

function paidOrderStatus(
  paidOrder: PendingAttempt['paid_order']
): string | undefined {
  if (!paidOrder) return undefined;
  return Array.isArray(paidOrder)
    ? paidOrder[0]?.payment_status
    : paidOrder.payment_status;
}

export interface AbandonedPaystackAttemptSummary {
  checked: number;
  completed: string[];
  failed: boolean;
  held: Array<{ id: string; reason: string; rotationFailed?: boolean }>;
  retired: string[];
  reviewsFiled: string[];
}

function isVerificationUnavailable(code: string | undefined): boolean {
  if (code === 'NETWORK_ERROR' || code === 'CONFIG_ERROR') return true;
  const status = Number(/^HTTP_(\d{3})$/.exec(code ?? '')?.[1]);
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

/** Clear old, superseded attempts only after checking their current Paystack status. */
export async function reconcileAbandonedPaystackAttempts({
  supabase,
  verify = verifyTransaction,
  limit = DEFAULT_LIMIT,
  olderThanMinutes = DEFAULT_OLDER_THAN_MINUTES,
  deadlineMs,
  scheduleAfter = () => {
    // No-op default for unit tests; the cron route passes after().
  },
}: {
  supabase: SupabaseClient;
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
  const { data: attempts, error: lookupError } = await supabase
    .from('transactions')
    .select(
      'id, order_id, merchant_id, gateway_reference, amount, currency, status, metadata, platform_fee, paid_order:orders!transactions_order_id_fkey!inner(payment_status)'
    )
    .eq('transaction_type', 'payment')
    .eq('gateway', 'paystack')
    .in('status', ['pending', 'processing'])
    .in('paid_order.payment_status', ['paid', 'partially_paid'])
    .not('order_id', 'is', null)
    .not('gateway_reference', 'is', null)
    .is('metadata->abandoned_sweep_resolution', null)
    .lt('created_at', cutoff)
    .lt('updated_at', recheckCutoff)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (lookupError) {
    throw new Error(
      `pending_paystack_attempt_lookup_failed: ${lookupError.message}`
    );
  }

  for (const attempt of (attempts ?? []) as PendingAttempt[]) {
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
    const guardAttempt = () =>
      supabase
        .from('transactions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', attempt.id)
        .eq('order_id', attempt.order_id)
        .eq('merchant_id', attempt.merchant_id)
        .eq('transaction_type', 'payment')
        .eq('gateway', 'paystack')
        .eq('gateway_reference', attempt.gateway_reference)
        .eq('status', attempt.status);
    const hold = async (reason: string) => {
      const entry: { id: string; reason: string; rotationFailed?: boolean } = {
        id: attempt.id,
        reason,
      };
      summary.held.push(entry);
      // Move unresolved attempts to the back of the next sweep instead of
      // allowing old pending attempts to starve newer candidates.
      try {
        const { error } = await guardAttempt();
        if (error) {
          entry.rotationFailed = true;
          summary.failed = true;
        }
      } catch {
        entry.rotationFailed = true;
        summary.failed = true;
      }
    };

    // Only clear attempts superseded by a different completed payment on an
    // already paid order. Other pending attempts still need payment recovery.
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id')
      .eq('id', attempt.order_id)
      .eq('merchant_id', attempt.merchant_id)
      .in('payment_status', ['paid', 'partially_paid'])
      .maybeSingle();
    if (orderError || !order) {
      if (orderError) summary.failed = true;
      await hold('order_not_paid_or_unavailable');
      continue;
    }
    const { data: completed, error: completedError } = await supabase
      .from('transactions')
      .select('id')
      .eq('order_id', attempt.order_id)
      .eq('merchant_id', attempt.merchant_id)
      .eq('transaction_type', 'payment')
      .eq('status', 'completed')
      .neq('id', attempt.id)
      .limit(1);
    if (completedError || !completed?.length) {
      if (completedError) summary.failed = true;
      await hold('no_completed_payment_or_unavailable');
      continue;
    }

    let result: Awaited<ReturnType<typeof verifyTransaction>>;
    try {
      result = await verify(
        attempt.gateway_reference,
        AbortSignal.timeout(VERIFY_TIMEOUT_MS)
      );
    } catch {
      summary.failed = true;
      await hold('verification_unavailable');
      continue;
    }
    if (!result.success) {
      if (result.code === 'VALIDATION_ERROR') {
        // The stored reference itself is malformed: provider verification
        // rejects it deterministically, so file a durable review and stamp
        // the row instead of rotating it on every sweep.
        const filed = await fileInvalidAttemptReference({
          attempt,
          reason: result.error,
          supabase,
        });
        if (filed) {
          summary.reviewsFiled.push(attempt.id);
          continue;
        }
        summary.failed = true;
        await hold('invalid_reference');
        continue;
      }
      if (isVerificationUnavailable(result.code)) summary.failed = true;
      if (
        result.code !== 'HTTP_404' ||
        attempt.metadata?.paystack_payment_type !== 'dva'
      ) {
        await hold('verification_unavailable');
        continue;
      }
    }
    let mismatchKind: string | null = null;
    if (result.success) {
      if (result.data.reference !== attempt.gateway_reference) {
        mismatchKind = 'reference_mismatch';
      } else if (
        !Number.isFinite(Number(attempt.amount)) ||
        Number(attempt.amount) <= 0 ||
        result.data.amount !== Math.round(Number(attempt.amount) * 100) ||
        typeof result.data.currency !== 'string' ||
        result.data.currency.toUpperCase() !==
          String(attempt.currency).toUpperCase()
      ) {
        mismatchKind = 'payment_evidence_mismatch';
      }
    }
    if (result.success && result.data.status === 'success') {
      await resolveVerifiedAbandonedAttemptCapture({
        attempt,
        hold,
        mismatchKind,
        paidOrderStatus: paidOrderStatus(attempt.paid_order),
        result,
        scheduleAfter,
        summary,
        supabase,
      });
      continue;
    }
    if (mismatchKind) {
      const filingFailed = await resolveAbandonedAttemptMismatch({
        attempt,
        hold,
        mismatchKind,
        result,
        reviewsFiled: summary.reviewsFiled,
        supabase,
      });
      if (filingFailed) summary.failed = true;
      continue;
    }
    if (
      result.success &&
      result.data.status !== 'abandoned' &&
      result.data.status !== 'failed'
    ) {
      await hold(result.data.status);
      continue;
    }

    // The order and reference guards prevent a concurrent webhook or retry
    // from being overwritten after provider verification.
    const retire = async () =>
      supabase
        .from('transactions')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', attempt.id)
        .eq('order_id', attempt.order_id)
        .eq('merchant_id', attempt.merchant_id)
        .eq('transaction_type', 'payment')
        .eq('gateway', 'paystack')
        .eq('gateway_reference', attempt.gateway_reference)
        .eq('status', attempt.status)
        .select('id');
    const retirement = await retire().catch(() => null);
    if (!retirement || retirement.error) {
      summary.failed = true;
      await hold('retirement_failed');
      continue;
    }
    if (retirement.data?.length === 1) {
      summary.retired.push(attempt.id);
    } else {
      summary.held.push({ id: attempt.id, reason: 'changed_concurrently' });
    }
  }

  return summary;
}
