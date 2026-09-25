import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';
import {
  retireWedgeWithReview,
  stampWedgeResolution,
} from '@/lib/payments/retire-wedge-with-review';
import {
  buildJuicywayVerificationContext,
  isHealableGateway,
  isTerminalGatewayVerificationReason,
  verifyGatewayCharge,
} from '@/lib/payments/verify-gateway-charge';

// Wedged gateway payments (completed txn, order never flipped), pending
// Juicyway sessions whose success webhook never arrived, and pending rows
// the sessionless verify GET already confirmed with the provider (flagged
// through the proof-bound flag RPC): heal after re-verifying with the
// gateway. Terminal outcomes file a review and stamp the row once.

const AMOUNT_TOLERANCE_MAJOR_UNITS = 0.01;
const DEFAULT_LIMIT = 10;
// Grace period so the sweep never races a webhook that is mid-flight.
const DEFAULT_OLDER_THAN_MINUTES = 15;

export interface WedgedOrderSweepSummary {
  checked: number;
  healed: Array<{ orderId: string; orderNumber: string | null }>;
  detectedUnhealable: Array<{ transactionId: string; gateway: string }>;
  reviewsFiled: Array<{ transactionId: string; orderId: string }>;
  skipped: Array<{ transactionId: string; reason: string }>;
  failed: Array<{ transactionId: string; reason: string }>;
}

type WedgedCandidate = {
  id: string;
  created_at: string;
  order_id: string;
  merchant_id: string;
  amount: number | string | null;
  currency: string | null;
  platform_fee: number | null;
  gateway: string;
  gateway_reference: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
};

export async function reconcileWedgedGatewayOrders({
  supabase,
  scheduleAfter,
  limit = DEFAULT_LIMIT,
  olderThanMinutes = DEFAULT_OLDER_THAN_MINUTES,
}: {
  supabase: SupabaseClient;
  scheduleAfter: (task: () => Promise<void>) => void;
  limit?: number;
  olderThanMinutes?: number;
}): Promise<WedgedOrderSweepSummary> {
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
  const { data: candidates, error: lookupError } = await supabase
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

  for (const raw of candidates ?? []) {
    const candidate = raw as unknown as WedgedCandidate;
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

      const verification = await verifyGatewayCharge(
        candidate.gateway,
        candidate.gateway_reference,
        candidate.gateway === 'juicyway'
          ? buildJuicywayVerificationContext(
              candidate.metadata,
              candidate.created_at
            )
          : undefined
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

      const outcome = await finalizeOrderGatewayPayment({
        actor: 'cron:reconcile-gateway-paid-orders',
        gateway: candidate.gateway,
        gatewayResponse: verification.response,
        orderId: candidate.order_id,
        reference: candidate.gateway_reference,
        scheduleAfter,
        supabase,
        transaction: {
          amount: candidate.amount,
          gateway_reference: candidate.gateway_reference,
          id: candidate.id,
          merchant_id: candidate.merchant_id,
          order_id: candidate.order_id,
          platform_fee: candidate.platform_fee,
        },
        wonTransactionFlip: candidate.status !== 'completed',
      });

      if (outcome.kind === 'completed') {
        logger.warn({
          healed: outcome.healed,
          message: 'Sweep healed a wedged gateway order payment',
          orderId: candidate.order_id,
          orderNumber: outcome.orderNumber,
          transactionId: candidate.id,
        });
        summary.healed.push({
          orderId: candidate.order_id,
          orderNumber: outcome.orderNumber,
        });
      } else if (
        outcome.kind === 'order_cancelled' ||
        outcome.kind === 'order_skipped'
      ) {
        // The finalizer filed the reconciliation_review row for the captured
        // funds; stamp the transaction so this terminal state is processed
        // exactly once.
        summary.reviewsFiled.push({
          orderId: candidate.order_id,
          transactionId: candidate.id,
        });
        await stampWedgeResolution(supabase, candidate, outcome.kind);
      } else {
        summary.failed.push({
          reason: outcome.kind,
          transactionId: candidate.id,
        });
      }
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
