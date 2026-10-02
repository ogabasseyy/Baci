import type { SupabaseClient } from '@supabase/supabase-js';
import type { verifyTransaction } from '@/lib/paystack';
import {
  isDefinitiveProviderRejection,
  isVerificationUnavailable,
} from './classify-paystack-verify-outcome';
import { fileInvalidAttemptReference } from './file-invalid-attempt-reference';
import { fileUnresolvedAttemptReference } from './file-unresolved-attempt-reference';
import type { finalizeOrderGatewayPayment } from './finalize-order-gateway-payment';
import { guardAbandonedPaystackAttempt } from './guard-abandoned-paystack-attempt';
import { processMissingReferenceAttempt } from './process-missing-reference-attempt';
import type { AbandonedPaystackAttemptSummary } from './reconcile-abandoned-paystack-attempts';
import { resolveAbandonedAttemptMismatch } from './resolve-abandoned-attempt-mismatch';
import { resolveVerifiedAbandonedAttemptCapture } from './resolve-verified-abandoned-attempt-capture';

const VERIFY_TIMEOUT_MS = 5_000;

interface PendingAttempt {
  amount: number;
  currency: string;
  gateway_reference: string | null;
  id: string;
  merchant_id: string;
  metadata: Record<string, unknown> | null;
  order_id: string;
  paid_order?: { payment_status: string } | Array<{ payment_status: string }>;
  platform_fee: number | null;
  status: 'pending' | 'processing' | 'completed';
}

function paidOrderStatus(
  paidOrder: PendingAttempt['paid_order']
): string | undefined {
  if (!paidOrder) return undefined;
  return Array.isArray(paidOrder)
    ? paidOrder[0]?.payment_status
    : paidOrder.payment_status;
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
  // No gateway predicate: the id/order/merchant/reference/status
  // filters already bind the row, and the sweep normalizes legacy
  // gateway spellings (` Paystack `) an exact match would miss. A
  // missing reference binds with IS NULL: `eq` never matches NULL.
  const guardAttempt = () => {
    const query = supabase
      .from('transactions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', attempt.id)
      .eq('order_id', attempt.order_id)
      .eq('merchant_id', attempt.merchant_id)
      .eq('transaction_type', 'payment');
    const bound =
      attempt.gateway_reference == null
        ? query.is('gateway_reference', null)
        : query.eq('gateway_reference', attempt.gateway_reference);
    return bound.eq('status', attempt.status);
  };
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

  const gatewayReference = attempt.gateway_reference;
  if (gatewayReference == null) {
    await processMissingReferenceAttempt(supabase, attempt, {
      hold,
      summary,
    });
    return;
  }
  // Narrowed view for the verifiable path below: every helper from
  // here on requires a concrete reference.
  const verifiableAttempt = { ...attempt, gateway_reference: gatewayReference };
  // A completed row is a filing-only retry: its duplicate filings
  // failed after the atomic finalizer settled it, so it must never
  // re-finalize nor retire — only its review is still owed.
  const isCompletedRetry = attempt.status === 'completed';
  const superseded = await guardAbandonedPaystackAttempt({
    attempt,
    hold,
    isCompletedRetry,
    summary,
    supabase,
  });
  if (superseded !== 'proceed') return;

  let result: Awaited<ReturnType<typeof verifyTransaction>>;
  try {
    result = await verify(
      gatewayReference,
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
        attempt: verifiableAttempt,
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
  // A completed retry files under any verified provider status: the
  // funds settled, so even a now-reversed charge owes the duplicate
  // review with the gateway's actual status instead of retiring.
  if (
    result.success &&
    (result.data.status === 'success' || isCompletedRetry)
  ) {
    await resolveVerifiedAbandonedAttemptCapture({
      attempt: verifiableAttempt,
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
      attempt: verifiableAttempt,
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

  if (isCompletedRetry) {
    // Verification failed outright (not a status verdict): never
    // un-complete an atomically settled payment — hold for the next
    // sweep instead of retiring it to failed.
    summary.failed = true;
    await hold('verification_unavailable');
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
      .eq('gateway_reference', gatewayReference)
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
