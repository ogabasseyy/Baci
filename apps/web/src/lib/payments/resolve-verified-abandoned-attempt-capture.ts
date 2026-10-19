import type { SupabaseClient } from '@supabase/supabase-js';
import type { verifyTransaction } from '@/lib/paystack';
import { fileDuplicatePaymentCapture } from './file-duplicate-payment-capture';
import type { finalizeOrderGatewayPayment } from './finalize-order-gateway-payment';
import { finalizePartiallyPaidAbandonedAttempt } from './finalize-partially-paid-abandoned-attempt';

type VerifiedCapture = Extract<
  Awaited<ReturnType<typeof verifyTransaction>>,
  { success: true }
>;

/**
 * Resolve a provider-verified capture on a stale attempt. On a partially
 * paid order the capture can be the legitimate remaining payment, so it
 * routes through the atomic order finalizer first. Otherwise the order is
 * already paid by another transaction and the capture is a possible
 * duplicate charge: file it for operations. A filing failure surfaces as a
 * sweep failure while the hold retains the retry.
 */
export async function resolveVerifiedAbandonedAttemptCapture({
  attempt,
  deadlineMs,
  finalizePayment,
  hold,
  mismatchKind,
  paidOrderStatus,
  result,
  scheduleAfter,
  summary,
  supabase,
}: {
  attempt: {
    amount: number;
    currency: string;
    gateway_reference: string;
    id: string;
    merchant_id: string;
    metadata: Record<string, unknown> | null;
    order_id: string;
    platform_fee: number | null;
    status: 'pending' | 'processing' | 'completed';
  };
  deadlineMs?: number;
  finalizePayment?: typeof finalizeOrderGatewayPayment;
  hold: (reason: string) => Promise<void>;
  mismatchKind: string | null;
  paidOrderStatus: string | undefined;
  result: VerifiedCapture;
  scheduleAfter: (task: () => Promise<void>) => void;
  summary: { completed: string[]; failed: boolean; reviewsFiled: string[] };
  supabase: SupabaseClient;
}): Promise<void> {
  if (!mismatchKind && paidOrderStatus === 'partially_paid') {
    if (attempt.status === 'completed') {
      // Defensive: the retry sweep never selects partially-paid orders
      // for completed rows, so re-finalizing one would misroute
      // settled funds. Hold instead of filing or finalizing.
      summary.failed = true;
      await hold('completed_capture_unexpected');
      return;
    }
    if (!finalizePayment) {
      summary.failed = true;
      await hold('payment_finalizer_unavailable');
      return;
    }
    // Proven non-completed by the guard above; the finalizer only
    // admits pending/processing rows.
    const finalizableAttempt = attempt as Omit<typeof attempt, 'status'> & {
      status: 'pending' | 'processing';
    };
    await finalizePartiallyPaidAbandonedAttempt({
      attempt: finalizableAttempt,
      deadlineMs,
      finalizePayment,
      hold,
      providerData: result.data as unknown as Record<string, unknown>,
      scheduleAfter,
      summary,
      supabase,
    });
    return;
  }
  const filed = await fileDuplicatePaymentCapture({
    attempt,
    evidence: {
      gateway: 'paystack',
      providerAmount: result.data.amount,
      providerCurrency: result.data.currency,
      providerReference: String(result.data.id),
      providerStatus: result.data.status,
      ...(mismatchKind
        ? {
            mismatchDetail: `provider ${result.data.reference} ${result.data.amount} ${result.data.currency}`,
            mismatchKind,
          }
        : {}),
    },
    supabase,
  });
  if (filed) {
    summary.reviewsFiled.push(attempt.id);
    return;
  }
  summary.failed = true;
  await hold(mismatchKind ?? 'success');
}
