import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { finalizeOrderGatewayPayment } from './finalize-order-gateway-payment';
import { verifyGatewayCharge } from './verify-gateway-charge';

export async function recheckPaidBankCardOfferCaptures({
  deadlineMs,
  finalizePayment,
  scheduleAfter,
  supabase,
}: {
  deadlineMs: number;
  finalizePayment: typeof finalizeOrderGatewayPayment;
  scheduleAfter: (task: () => Promise<void>) => void;
  supabase: SupabaseClient;
}) {
  const summary = { checked: 0, failed: 0, retrying: 0, reversed: 0 };
  while (true) {
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) break;
    const signal = AbortSignal.timeout(remainingMs);
    const claim = supabase.rpc('claim_paid_bank_card_offer_recheck');
    const { data, error } = await claim.abortSignal(signal);
    if (error) {
      logger.warn({
        message: 'Unable to claim a paid bank card offer for recheck',
        code: error.code,
      });
      summary.failed += 1;
      break;
    }
    const capture = data?.[0];
    if (!capture) break;

    summary.checked += 1;
    const reference = capture.gateway_reference;
    try {
      const verification = await verifyGatewayCharge(
        'paystack',
        reference,
        undefined,
        signal
      );
      if (verification.ok) continue;
      if (
        verification.reason === 'paystack_verification_unavailable' ||
        verification.gatewayStatus === 'pending' ||
        verification.gatewayStatus === 'processing' ||
        verification.gatewayStatus === 'ongoing' ||
        verification.gatewayStatus === 'queued'
      ) {
        summary.retrying += 1;
        continue;
      }
      if (verification.gatewayStatus !== 'reversed') {
        summary.failed += 1;
        continue;
      }

      // Recheck against the saved provider domain, reference and currency.
      // This finalizer mode can only record terminal review evidence.
      const outcome = await finalizePayment({
        actor: 'cron:reconcile-gateway-paid-orders',
        expectedBankOfferTerminalStatus: 'reversed',
        gateway: 'paystack',
        orderId: capture.order_id,
        reference,
        scheduleAfter,
        signal,
        supabase,
        transaction: {
          amount: null,
          gateway_reference: reference,
          id: capture.transaction_id,
          merchant_id: capture.merchant_id,
          order_id: capture.order_id,
          platform_fee: null,
        },
      });
      if (
        outcome.kind === 'bank_offer_terminal' &&
        outcome.status === 'reversed'
      ) {
        summary.reversed += 1;
      } else {
        summary.failed += 1;
      }
    } catch {
      // The database claim advances the retry time without retiring the capture.
      logger.warn({
        message:
          'Paid bank card offer recheck failed before recording a verdict',
        orderId: capture.order_id,
        transactionId: capture.transaction_id,
      });
      summary.failed += 1;
    }
  }
  return summary;
}
