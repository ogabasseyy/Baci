import 'server-only';
import { verifyTransaction } from '@/lib/paystack';
import { createServiceClient } from '@/lib/supabase/service';
import { dispatchRepairPickupPayment } from './dispatch-repair-pickup-payment';
import { repairPickupPaymentClaims } from './repair-pickup-payment-claim';
import type { StartRepairPickupPaymentResult } from './start-repair-pickup-payment-types';

export async function reconcileMobileRepairPickupPayment(
  result: StartRepairPickupPaymentResult,
  merchantId: string
): Promise<StartRepairPickupPaymentResult> {
  if (result.success || !result.reference) return result;
  try {
    const verified = await verifyTransaction(result.reference);
    if (!verified.success) return result;
    const payment = verified.data;
    const claim = repairPickupPaymentClaims.verify(
      payment.metadata,
      process.env.PAYSTACK_SECRET_KEY ?? ''
    );
    if (
      !claim ||
      claim.merchantId !== merchantId ||
      claim.repairId !== result.id ||
      claim.reference !== result.reference ||
      payment.reference !== result.reference ||
      payment.amount !== result.amountKobo ||
      claim.amountKobo !== result.amountKobo ||
      payment.currency !== result.currency ||
      claim.currency !== result.currency
    )
      return result;
    // Authoritative verification: persist and dispatch through the same
    // idempotent path the webhook uses. Verification never creates a new
    // charge; the receipt stays unknown (no authorization URL survived to
    // hand back), so a repeated retry replays the same idempotent
    // fulfillment instead of stranding the paid pickup.
    if (payment.status === 'success') {
      if (result.id) {
        try {
          const dispatched = await dispatchRepairPickupPayment({
            gateway: 'paystack',
            gatewayResponse: verified.data as unknown as Record<
              string,
              unknown
            >,
            reference: result.reference,
            supabase: createServiceClient(),
            // Paystack verifies in kobo; the dispatch takes major units.
            verifiedAmount: payment.amount / 100,
          });
          if (dispatched?.ok)
            return {
              ...result,
              error:
                'Payment received. Your pickup is confirmed; check this repair ticket for pickup details.',
            };
        } catch {
          // A later retry replays fulfillment; keep the recovery message.
        }
      }
      return {
        ...result,
        error:
          'Payment received. Check this repair ticket for pickup confirmation.',
      };
    }
    if (payment.status === 'failed' || payment.status === 'abandoned')
      // A terminal provider outcome retires the unknown attempt: no charge can
      // still land, so the customer may safely start another payment.
      return {
        ...result,
        code: 'payment_initialization_failed',
        error:
          'The previous payment attempt did not complete. Start a new payment to continue.',
      };
    return {
      ...result,
      error:
        'The original payment is not confirmed. Keep this ticket and contact the store for payment recovery.',
    };
  } catch {
    return result;
  }
}
