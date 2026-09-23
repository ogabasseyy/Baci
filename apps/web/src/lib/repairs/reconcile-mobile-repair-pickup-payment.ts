import 'server-only';
import { verifyTransaction } from '@/lib/paystack';
import { repairPickupPaymentClaims } from './repair-pickup-payment-claim';
import type { StartRepairPickupPaymentResult } from './start-repair-pickup-payment-types';

export async function reconcileMobileRepairPickupPayment(
  result: StartRepairPickupPaymentResult,
  merchantId: string
): Promise<StartRepairPickupPaymentResult> {
  if (result.success || !result.reference) return result;
  try {
    const verified = await verifyTransaction(result.reference);
    if (!verified.success) {
      // Paystack authoritatively reports unknown references with HTTP 404, so
      // a 404 proves no charge can exist for this reference: fail definitively
      // so the client retires the unknown attempt and starts a fresh payment
      // instead of replaying an unreclaimable unknown receipt forever. Every
      // other verification failure (network, 5xx, auth) stays unknown because
      // the provider state is still ambiguous.
      if (verified.code === 'HTTP_404')
        return {
          ...result,
          code: 'payment_initialization_failed',
          error:
            'The previous payment attempt did not reach Paystack. Start a new payment to continue.',
        };
      return result;
    }
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
    // Authoritative verification only: fulfillment stays on the
    // Paystack-authenticated webhook path because user-facing code must never
    // construct a service-role client. The verified success persists through
    // the fenced receipt completion write, so the receipt is durably
    // confirmed (never stranded on unknown) and any webhook redelivery books
    // the pickup idempotently. Verification never creates a new charge.
    if (payment.status === 'success')
      return {
        ...result,
        error:
          'Payment received. Check this repair ticket for pickup confirmation.',
      };
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
