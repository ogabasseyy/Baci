import type { SupabaseClient } from '@supabase/supabase-js';
import { fileInvalidPaystackRefundEvidenceReview } from './file-invalid-paystack-refund-evidence-review';
import { resolvePaystackRefundRecoveryWatch } from './resolve-paystack-refund-recovery-watch';

/**
 * File the provider evidence for a verified refund whose transaction
 * pointer is malformed — or whose resolved payment reference is
 * missing/outside the recovery alphabet — so no payment can resolve.
 * Throwing bare would 503 every redelivery with no durable trace, and
 * polling can never rediscover an unknown refund. Files against the
 * webhook hint (or a refund-keyed fallback when the event carries
 * none); the caller still throws for glitch recovery. No-ops for any
 * other error.
 */
export async function fileInvalidRefundEvidenceBeforeReject(
  supabase: SupabaseClient,
  {
    error,
    paymentReference,
    refundId,
  }: {
    error: unknown;
    paymentReference?: string;
    refundId: number;
  }
): Promise<void> {
  if (
    !(error instanceof Error) ||
    (error.message !== 'paystack_refund_transaction_invalid' &&
      error.message !== 'paystack_refund_payment_reference_invalid')
  ) {
    return;
  }
  const raw = (error as { providerRefund?: unknown }).providerRefund as
    | {
        amount?: unknown;
        currency?: unknown;
        status?: unknown;
        transaction?: unknown;
      }
    | null
    | undefined;
  const reference = paymentReference ?? `unknown-refund:${refundId}`;
  const reason =
    error.message === 'paystack_refund_transaction_invalid'
      ? `Paystack refund ${refundId} returned a malformed transaction pointer for reference ${reference}`
      : `Paystack refund ${refundId} resolved a payment reference outside the recovery alphabet for reference ${reference}`;
  await fileInvalidPaystackRefundEvidenceReview(supabase, {
    evidence: {
      providerPaymentTransactionId: raw?.transaction,
      providerRefundId: refundId,
      providerRefundStatus:
        typeof raw?.status === 'string' ? raw.status : 'unknown',
      reference,
    },
    reason,
    reference,
    refundId,
  });
  await resolvePaystackRefundRecoveryWatch(supabase, {
    providerRefundId: refundId,
    reference,
  });
}
