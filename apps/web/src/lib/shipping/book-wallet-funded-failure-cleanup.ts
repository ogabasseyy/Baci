import type { SupabaseClient } from '@supabase/supabase-js';
import { markBookingLockMustStay } from './booking-lock-must-stay';
import {
  markMerchantShippingChargeForReconciliation,
  refundMerchantShippingCharge,
} from './merchant-shipping-charge';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';
import { ShippingBookingRejectedError } from './types';

type ReleaseLock = () => Promise<void>;

/**
 * Settles the wallet charge after a failed booking attempt without ever
 * replacing the original error: a definitive failure is refunded and the lock
 * freed; a failed refund is handed to reconciliation and the lock stays; an
 * ambiguous failure goes to reconciliation with the carrier reference.
 */
export async function cleanupWalletFundedFailure({
  supabase,
  chargeId,
  token,
  error,
  definitive,
  releaseLock,
  bookedReference,
}: {
  supabase: SupabaseClient;
  chargeId: string;
  token: string;
  error: unknown;
  definitive: boolean;
  releaseLock?: ReleaseLock;
  bookedReference?: string;
}): Promise<void> {
  if (!definitive) {
    await markMerchantShippingChargeForReconciliation(
      supabase,
      chargeId,
      token,
      error instanceof OrderShipmentBookingError
        ? error.code
        : 'UNKNOWN_PROVIDER_FAILURE',
      (error instanceof OrderShipmentBookingError ||
      error instanceof ShippingBookingRejectedError
        ? error.providerReference
        : undefined) ?? bookedReference
    );
    return;
  }
  try {
    await refundMerchantShippingCharge(
      supabase,
      chargeId,
      token,
      error instanceof OrderShipmentBookingError
        ? error.code
        : 'BOOKING_REJECTED'
    );
  } catch (refundError) {
    // Keep the provider error and the lock: the charge is still reserved, so
    // hand it to reconciliation rather than inviting a retry.
    markBookingLockMustStay(error);
    console.error(
      'Wallet shipping refund failed after a rejected provider attempt:',
      refundError
    );
    try {
      await markMerchantShippingChargeForReconciliation(
        supabase,
        chargeId,
        token,
        'REFUND_FAILED_AFTER_REJECTED_ATTEMPT',
        undefined
      );
    } catch (markError) {
      console.error(
        'Wallet shipping reconciliation marking failed:',
        markError
      );
    }
    return;
  }
  if (releaseLock) {
    // A failed release must not replace the provider error, so the routes can
    // still answer and record the real cause.
    try {
      await releaseLock();
    } catch (releaseError) {
      console.error(
        'Failed to release shipment booking lock after a refunded wallet attempt:',
        releaseError
      );
    }
  }
}
