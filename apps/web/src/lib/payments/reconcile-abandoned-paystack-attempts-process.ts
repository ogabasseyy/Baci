import type { SupabaseClient } from '@supabase/supabase-js';
import type { verifyTransaction } from '@/lib/paystack';
import { fileInvalidAttemptReference } from './file-invalid-attempt-reference';
import { fileUnresolvedAttemptReference } from './file-unresolved-attempt-reference';
import type { finalizeOrderGatewayPayment } from './finalize-order-gateway-payment';
import type { AbandonedPaystackAttemptSummary } from './reconcile-abandoned-paystack-attempts';
import { resolveAbandonedAttemptMismatch } from './resolve-abandoned-attempt-mismatch';
import { resolveVerifiedAbandonedAttemptCapture } from './resolve-verified-abandoned-attempt-capture';

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

function isVerificationUnavailable(code: string | undefined): boolean {
  if (code === 'NETWORK_ERROR' || code === 'CONFIG_ERROR') return true;
  const status = Number(/^HTTP_(\d{3})$/.exec(code ?? '')?.[1]);
  return (
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 429 ||
    status >= 500
  );
}

// Client errors other than auth/timeout/rate-limit/missing mean Paystack
// deterministically rejects this reference: it will never verify on
// retry, so review it instead of holding it as an outage forever. A 408
// is a transient provider timeout, not a verdict on the reference:
// retiring it would stamp a still-pending transaction out of future
// sweeps while cancellation keeps rejecting pending attempts.
function isDefinitiveProviderRejection(code: string | undefined): boolean {
  const status = Number(/^HTTP_(\d{3})$/.exec(code ?? '')?.[1]);
  return (
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 403 &&
    status !== 404 &&
    status !== 408 &&
    status !== 429
  );
}

/** Verify one superseded attempt and retire, complete, hold, or review it. */
export async function processAbandonedPaystackAttempt(
  supabase: SupabaseClient,
  attempt: PendingAttempt,
  {
    deadlineMs,
    finalizePayment,
    scheduleAfter,
    summary,
    verify,
  }: {
    deadlineMs?: number;
    finalizePayment?: typeof finalizeOrderGatewayPayment;
    scheduleAfter: (task: () => Promise<void>) => void;
    summary: AbandonedPaystackAttemptSummary;
    verify: typeof verifyTransaction;
  }
): Promise<void> {
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
    return;
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
    return;
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
    return;
  }
  if (!result.success) {
    if (
      result.code === 'VALIDATION_ERROR' ||
      isDefinitiveProviderRejection(result.code)
    ) {
      // The stored reference itself is malformed, or Paystack
      // deterministically rejects it (e.g. HTTP_400 on a stale card
      // reference): either way verification will never succeed on
      // retry, so file a durable review and stamp the row instead of
      // rotating it on every sweep.
      const reason =
        result.code === undefined || result.code === 'VALIDATION_ERROR'
          ? result.error
          : result.code;
      const filed = await fileInvalidAttemptReference({
        attempt,
        reason,
        supabase,
      });
      if (filed) {
        summary.reviewsFiled.push(attempt.id);
        return;
      }
      summary.failed = true;
      await hold('invalid_reference');
      return;
    }
    if (isVerificationUnavailable(result.code)) summary.failed = true;
    if (
      result.code === 'HTTP_404' &&
      attempt.metadata?.paystack_payment_type !== 'dva'
    ) {
      // A non-DVA reference Paystack cannot find: unlike a DVA 404 this
      // is not retired (a spurious 404 must not strand a funded
      // payment), but rotating silently forever hides it from
      // operations while merchant cancellation keeps rejecting the
      // paid order. File a durable review — deduped, unstamped — and
      // keep rotating for a late verify.
      const filed = await fileUnresolvedAttemptReference({
        attempt,
        reason: result.code,
        supabase,
      });
      if (filed) {
        summary.reviewsFiled.push(attempt.id);
      } else {
        summary.failed = true;
      }
      await hold('verification_unavailable');
      return;
    }
    if (
      result.code !== 'HTTP_404' ||
      attempt.metadata?.paystack_payment_type !== 'dva'
    ) {
      await hold('verification_unavailable');
      return;
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
      deadlineMs,
      finalizePayment,
      hold,
      mismatchKind,
      paidOrderStatus: paidOrderStatus(attempt.paid_order),
      result,
      scheduleAfter,
      summary,
      supabase,
    });
    return;
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
    return;
  }
  // A provider-reversed attempt is terminal like failed/abandoned:
  // the money came back, so retire it instead of rotating `updated_at`
  // on every sweep (merchant cancellation rejects pending/processing).
  if (
    result.success &&
    result.data.status !== 'abandoned' &&
    result.data.status !== 'failed' &&
    result.data.status !== 'reversed'
  ) {
    await hold(result.data.status);
    return;
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
    return;
  }
  if (retirement.data?.length === 1) {
    summary.retired.push(attempt.id);
  } else {
    summary.held.push({ id: attempt.id, reason: 'changed_concurrently' });
  }
}
