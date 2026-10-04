import 'server-only';
import { initializeTransaction } from '@/lib/paystack';
import type {
  StartRepairPickupPaymentInput,
  StartRepairPickupPaymentResult,
} from './start-repair-pickup-payment-types';

export async function initializeRepairPickupPayment(
  payload: Parameters<typeof initializeTransaction>[0],
  repair: { id: string; ticketNumber: number; resumeToken: string },
  checkpoint?: StartRepairPickupPaymentInput['onPaymentInitializationCheckpoint'],
  onBeforeProviderInitialization?: StartRepairPickupPaymentInput['onBeforeProviderInitialization']
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
  // Fence execution immediately before the provider can accept the request.
  // The receipt claim stays reclaimable through the merchant lookup, quote,
  // and repair setup; the fenced completion writes below require this fence.
  await onBeforeProviderInitialization?.();
  // Persist the bound reference before the provider can accept the request.
  await checkpoint?.(unknown);
  let payment: Awaited<ReturnType<typeof initializeTransaction>>;
  try {
    payment = await initializeTransaction(payload);
    if (
      !payment?.authorization_url ||
      (payload.reference != null && payment.reference !== payload.reference)
    ) {
      // A 200 with a missing checkout URL or an echoed reference that does
      // not match the bound request proves nothing about the provider state:
      // stay on the unknown path so reconciliation replays the receipt
      // instead of checkpointing a malformed success the receipt schema can
      // never replay.
      throw new Error(
        'Paystack returned an invalid payment initialization response.'
      );
    }
  } catch (error) {
    console.error('Repair pickup payment initialization failed:', error);
    if (!checkpoint) {
      // Callers without a receipt-backed reconciliation path keep the failure
      // contract the web wizard recovers from.
      return {
        success: false,
        code: 'payment_initialization_failed',
        error:
          'Your repair request was saved, but payment could not start. Use your ticket to retry shortly.',
        ...repair,
      };
    }
    return unknown;
  }
  const succeeded: StartRepairPickupPaymentResult = {
    success: true,
    ...repair,
    payment: {
      amount: payload.amount / 100,
      authorizationUrl: payment.authorization_url,
      reference: payment.reference,
    },
  };
  // Persist the provider success before returning: a lost final write must
  // replay this receipt instead of stranding the customer on unknown. A failed
  // checkpoint still returns the in-memory success so the caller's completion
  // write can persist it.
  try {
    await checkpoint?.(succeeded);
  } catch (checkpointError) {
    console.error(
      'Repair pickup payment success checkpoint failed; the completion write will persist it:',
      checkpointError
    );
  }
  return succeeded;
}
