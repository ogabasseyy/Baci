import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';
import { finalizeVerifiedWedge } from '@/lib/payments/finalize-verified-wedge';
import type {
  WedgedCandidate,
  WedgedOrderSweepSummary,
} from '@/lib/payments/reconcile-wedged-gateway-orders.types';
import { remainingVerificationSignal } from '@/lib/payments/remaining-verification-signal';
import {
  retireWedgeWithReview,
  stampWedgeResolution,
} from '@/lib/payments/retire-wedge-with-review';
import {
  buildJuicywayVerificationContext,
  type HealableGateway,
  isHealableGateway,
  isTerminalGatewayVerificationReason,
  verifyGatewayCharge,
} from '@/lib/payments/verify-gateway-charge';

// Reverify wedged captures; file and stamp terminal outcomes once.

const AMOUNT_TOLERANCE_MAJOR_UNITS = 0.01;
const DEFAULT_LIMIT = 10;
// Grace period so the sweep never races a webhook that is mid-flight.
const DEFAULT_OLDER_THAN_MINUTES = 15;

export type { WedgedOrderSweepSummary } from './reconcile-wedged-gateway-orders.types';

export async function reconcileWedgedGatewayOrders({
  supabase,
  scheduleAfter,
  beforeSweep,
  limit = DEFAULT_LIMIT,
  olderThanMinutes = DEFAULT_OLDER_THAN_MINUTES,
  deadlineMs,
}: {
  supabase: SupabaseClient;
  scheduleAfter: (task: () => Promise<void>) => void;
  beforeSweep?: (authorities: {
    finalizePayment: typeof finalizeOrderGatewayPayment;
    fileWedgeReview: typeof retireWedgeWithReview;
  }) => Promise<void>;
  limit?: number;
  olderThanMinutes?: number;
  deadlineMs?: number;
}): Promise<WedgedOrderSweepSummary> {
  await beforeSweep?.({
    finalizePayment: finalizeOrderGatewayPayment,
    fileWedgeReview: retireWedgeWithReview,
  });
  const summary: WedgedOrderSweepSummary = {
    checked: 0,
    detectedUnhealable: [],
    failed: [],
    healed: [],
    reviewsFiled: [],
    skipped: [],
  };

  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();

  // Cancelled/refunded orders stay in scope (the finalizer files their
  // review); every terminal outcome is stamped so it never consumes the
  // batch again nor starves healable candidates.
  const { data: mainCandidates, error: lookupError } = await supabase
    .from('transactions')
    .select(
      'id, created_at, order_id, merchant_id, amount, currency, platform_fee, gateway, gateway_reference, metadata, status, orders!transactions_order_id_fkey!inner(id, payment_status, cancelled_at)'
    )
    .eq('transaction_type', 'payment')
    // Pending Paystack/Korapay rows enter only via the provider-confirmed
    // flag (first flag wins, so re-polls do not extend the webhook grace
    // below): abandoned attempts without provider confirmation stay out
    // of the sweep instead of retiring with ops reviews.
    .or(
      'status.eq.completed,and(status.eq.pending,gateway.eq.juicyway),and(status.eq.pending,metadata->>guest_provider_confirmed.eq.true)'
    )
    .not('order_id', 'is', null)
    .lt('updated_at', cutoff)
    .neq('orders.payment_status', 'paid')
    .is('metadata->wedge_sweep_resolution', null)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (lookupError) {
    throw new Error(`wedged_order_lookup_failed: ${lookupError.message}`);
  }

  // Filing-only retries: completed captures on paid orders whose
  // duplicate filings both failed carry the retry marker. Unstamped
  // only — a stamped row already reached a terminal outcome.
  const { data: pendingRetries, error: pendingError } = await supabase
    .from('transactions')
    .select(
      'id, created_at, order_id, merchant_id, amount, currency, platform_fee, gateway, gateway_reference, metadata, status, orders!transactions_order_id_fkey!inner(id, payment_status, cancelled_at)'
    )
    .eq('transaction_type', 'payment')
    .eq('status', 'completed')
    .eq('orders.payment_status', 'paid')
    .eq('metadata->>duplicate_capture_review_pending', 'true')
    .not('order_id', 'is', null)
    .lt('updated_at', cutoff)
    .is('metadata->wedge_sweep_resolution', null)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (pendingError) {
    throw new Error(`wedged_order_lookup_failed: ${pendingError.message}`);
  }

  const candidates = [...(mainCandidates ?? []), ...(pendingRetries ?? [])];

  for (const raw of candidates) {
    const candidate = raw as unknown as WedgedCandidate;
    // Stop starting candidates at the pass deadline: serial provider
    // re-verification can outlast the invocation budget, and unstarted
    // rows stay eligible for the next sweep.
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
      logger.info({
        message: 'Stopping wedged-order sweep at pass deadline',
        transactionId: candidate.id,
      });
      break;
    }
    summary.checked += 1;

    try {
      if (!candidate.gateway_reference) {
        summary.skipped.push({
          reason: 'missing_gateway_reference',
          transactionId: candidate.id,
        });
        // Permanent: nothing to verify against. File for ops, then retire.
        await retireWedgeWithReview({
          candidate,
          reason: `Wedge sweep: completed ${candidate.gateway} transaction ${candidate.id} has no gateway reference to verify; manual reconciliation required`,
          resolution: 'missing_gateway_reference',
          supabase,
        });
        continue;
      }

      if (!isHealableGateway(candidate.gateway)) {
        logger.error({
          gateway: candidate.gateway,
          message:
            'Wedged gateway order payment detected on a gateway the sweep cannot re-verify; manual reconciliation required',
          orderId: candidate.order_id,
          transactionId: candidate.id,
        });
        summary.detectedUnhealable.push({
          gateway: candidate.gateway,
          transactionId: candidate.id,
        });
        // Durable ops item before the row retires: captured money, unpaid
        // order, and no way to auto-verify this gateway.
        await retireWedgeWithReview({
          candidate,
          reason: `Wedge sweep: completed ${candidate.gateway} transaction with an unpaid order cannot be auto-verified; manual reconciliation required (reference ${candidate.gateway_reference})`,
          resolution: 'unhealable_gateway_logged',
          supabase,
        });
        continue;
      }

      // A deadline leaves unstarted rows for the next pass.
      const verifySignal = remainingVerificationSignal(deadlineMs);
      if (verifySignal === null) {
        logger.info({
          message: 'Stopping wedged-order sweep at pass deadline',
          transactionId: candidate.id,
        });
        break;
      }
      const verification = await verifyGatewayCharge(
        candidate.gateway,
        candidate.gateway_reference,
        candidate.gateway === 'juicyway'
          ? buildJuicywayVerificationContext(
              candidate.metadata,
              candidate.created_at
            )
          : undefined,
        verifySignal
      );

      if (!verification.ok) {
        summary.skipped.push({
          reason: verification.reason,
          transactionId: candidate.id,
        });
        if (isTerminalGatewayVerificationReason(verification.reason)) {
          // Definitive gateway verdict or evidence mismatch: file for ops and
          // retire the row. Transient/pending outcomes stay in the sweep.
          await retireWedgeWithReview({
            candidate,
            reason: `Wedge sweep: ${candidate.gateway} could not safely confirm reference ${candidate.gateway_reference} (${verification.reason}${verification.gatewayStatus ? `: ${verification.gatewayStatus}` : ''}); manual reconciliation required`,
            resolution:
              verification.reason === 'gateway_status_not_success'
                ? 'gateway_verification_negative'
                : verification.reason,
            supabase,
          });
        }
        // Transient verification failures stay unstamped and retry next run.
        continue;
      }

      const expectedAmount = Number(candidate.amount) || 0;
      if (
        candidate.gateway !== 'juicyway' &&
        Math.abs(verification.amount - expectedAmount) >
          AMOUNT_TOLERANCE_MAJOR_UNITS
      ) {
        summary.skipped.push({
          reason: 'amount_mismatch',
          transactionId: candidate.id,
        });
        // A real-money discrepancy must stay visible to ops after the row
        // retires from the hourly batch.
        await retireWedgeWithReview({
          candidate,
          reason: `Wedge sweep: gateway verified amount ${verification.amount} does not match transaction amount ${expectedAmount} for ${candidate.gateway} reference ${candidate.gateway_reference}`,
          resolution: 'amount_mismatch',
          supabase,
        });
        continue;
      }
      if (
        candidate.gateway !== 'juicyway' &&
        candidate.currency &&
        verification.currency &&
        candidate.currency.toUpperCase() !== verification.currency.toUpperCase()
      ) {
        summary.skipped.push({
          reason: 'currency_mismatch',
          transactionId: candidate.id,
        });
        await retireWedgeWithReview({
          candidate,
          reason: `Wedge sweep: gateway verified currency ${verification.currency} does not match transaction currency ${candidate.currency} for ${candidate.gateway} reference ${candidate.gateway_reference}`,
          resolution: 'currency_mismatch',
          supabase,
        });
        continue;
      }

      // Narrowed by the missing-reference and unhealable-gateway guards
      // above: only reference-carrying healable-gateway candidates reach
      // finalization.
      const healableCandidate = candidate as Omit<
        WedgedCandidate,
        'gateway' | 'gateway_reference'
      > & { gateway: HealableGateway; gateway_reference: string };
      const finalizeAction = await finalizeVerifiedWedge({
        candidate: healableCandidate,
        deadlineMs,
        finalizePayment: finalizeOrderGatewayPayment,
        scheduleAfter,
        stampResolution: stampWedgeResolution,
        summary,
        supabase,
        verification,
      });
      if (finalizeAction === 'stop') break;
    } catch (candidateError) {
      logger.error({
        error: candidateError,
        message: 'Wedged order sweep failed for candidate',
        transactionId: candidate.id,
      });
      summary.failed.push({
        reason:
          candidateError instanceof Error
            ? candidateError.message
            : 'unknown_error',
        transactionId: candidate.id,
      });
    }
  }

  return summary;
}
