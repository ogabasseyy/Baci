import 'server-only';
import { initializeTransaction } from '@/lib/paystack';
import type {
  StartRepairPickupPaymentInput,
  StartRepairPickupPaymentResult,
} from './start-repair-pickup-payment-types';

export async function initializeRepairPickupPayment(
  payload: Parameters<typeof initializeTransaction>[0],
  repair: { id: string; ticketNumber: number; resumeToken: string },
  checkpoint?: StartRepairPickupPaymentInput['onPaymentInitializationStarted']
): Promise<StartRepairPickupPaymentResult> {
  const unknown: StartRepairPickupPaymentResult = {
    success: false,
    code: 'payment_initialization_unknown',
    error:
      'Payment initialization is being reconciled. Keep this repair ticket and check its status; do not start another payment.',
    ...repair,
    reference: payload.reference,
    amountKobo: payload.amount,
    currency: 'NGN',
  };
  // Persist the bound reference before the provider can accept the request.
  await checkpoint?.(unknown);
  try {
    const payment = await initializeTransaction(payload);
    return {
      success: true,
      ...repair,
      payment: {
        amount: payload.amount / 100,
        authorizationUrl: payment.authorization_url,
        reference: payment.reference,
      },
    };
  } catch {
    return unknown;
  }
}
