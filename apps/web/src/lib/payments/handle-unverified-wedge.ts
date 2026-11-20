import type { SupabaseClient } from '@supabase/supabase-js';
import type { finalizeOrderGatewayPayment } from './finalize-order-gateway-payment';
import type {
  WedgedCandidate,
  WedgedOrderSweepSummary,
} from './reconcile-wedged-gateway-orders.types';
import type {
  retireWedgeWithReview,
  stampWedgeResolution,
} from './retire-wedge-with-review';
import {
  type GatewayChargeVerification,
  isTerminalGatewayVerificationReason,
} from './verify-gateway-charge';

export async function handleUnverifiedWedge({
  candidate,
  finalizePayment,
  retire,
  stamp,
  scheduleAfter,
  signal,
  summary,
  supabase,
  verification,
}: {
  candidate: WedgedCandidate;
  finalizePayment: typeof finalizeOrderGatewayPayment;
  retire: typeof retireWedgeWithReview;
  stamp: typeof stampWedgeResolution;
  scheduleAfter: (task: () => Promise<void>) => void;
  signal?: AbortSignal;
  summary: WedgedOrderSweepSummary;
  supabase: SupabaseClient;
  verification: Extract<GatewayChargeVerification, { ok: false }>;
}) {
  const reference = candidate.gateway_reference;
  summary.skipped.push({
    reason: verification.reason,
    transactionId: candidate.id,
  });

  if (
    candidate.gateway === 'paystack' &&
    reference?.startsWith('BCO-') &&
    verification.gatewayStatus === 'reversed'
  ) {
    // The shared finalizer verifies the original domain, reference and
    // currency against the saved offer before it records a reversal.
    const outcome = await finalizePayment({
      actor: 'cron:reconcile-gateway-paid-orders',
      bankOfferReversalOnly: true,
      gateway: 'paystack',
      orderId: candidate.order_id,
      reference,
      scheduleAfter,
      signal,
      supabase,
      transaction: { ...candidate, gateway_reference: reference },
    });
    if (
      outcome.kind === 'bank_offer_terminal' &&
      outcome.status === 'reversed'
    ) {
      summary.reviewsFiled.push({
        orderId: candidate.order_id,
        transactionId: candidate.id,
      });
      await stamp(supabase, candidate, 'gateway_verification_negative');
    } else {
      // Leave the row eligible for retry while the reversal is unconfirmed.
      summary.failed.push({
        reason: outcome.kind,
        transactionId: candidate.id,
      });
    }
    return;
  }

  // Transient/pending outcomes stay unstamped and retry next run.
  if (!isTerminalGatewayVerificationReason(verification.reason)) return;
  await retire({
    candidate,
    reason: `Wedge sweep: ${candidate.gateway} could not safely confirm reference ${reference} (${verification.reason}${verification.gatewayStatus ? `: ${verification.gatewayStatus}` : ''}); manual reconciliation required`,
    resolution:
      verification.reason === 'gateway_status_not_success'
        ? 'gateway_verification_negative'
        : verification.reason,
    supabase,
  });
}
