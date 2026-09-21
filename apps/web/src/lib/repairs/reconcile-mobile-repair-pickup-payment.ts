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
    // The authenticated webhook owns fulfillment; verification never creates a new charge.
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
