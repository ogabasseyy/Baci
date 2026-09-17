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
    return {
      ...result,
      error:
        payment.status === 'success'
          ? 'Payment received. Check this repair ticket for pickup confirmation.'
          : 'The original payment is not confirmed. Keep this ticket and contact the store for payment recovery.',
    };
  } catch {
    return result;
  }
}
