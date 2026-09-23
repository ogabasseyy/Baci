import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookOrderShipmentResult } from './book-order-shipment';
import {
  beginMerchantShippingChargeSubmission,
  completeMerchantShippingCharge,
  recoverMerchantShippingChargeForPersistedShipment,
} from './merchant-shipping-charge';
import { shouldReleaseBookingLock } from './order-shipment-booking-lock-errors';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';

type ReadExistingShipment = () => Promise<BookOrderShipmentResult | null>;
type ReleaseLock = () => Promise<void>;

export async function readPendingWalletExistingShipment(
  readExistingShipment: ReadExistingShipment,
  releaseLock?: ReleaseLock
): Promise<BookOrderShipmentResult | null> {
  try {
    return await readExistingShipment();
  } catch (error) {
    if (releaseLock && shouldReleaseBookingLock(error)) {
      try {
        await releaseLock();
      } catch (releaseError) {
        console.error(
          'Failed to release shipment booking lock after existing-shipment lookup error:',
          releaseError
        );
      }
    }
    throw error;
  }
}

export async function finalizeWalletFundedExistingShipment(
  supabase: SupabaseClient,
  chargeId: string,
  token: string,
  chargeStatus: string,
  existingShipment: BookOrderShipmentResult
): Promise<BookOrderShipmentResult> {
  if (chargeStatus === 'provider_submitting') {
    await recoverMerchantShippingChargeForPersistedShipment(
      supabase,
      chargeId,
      token,
      existingShipment.shipmentId
    );
    return existingShipment;
  }
  if (chargeStatus === 'reserved') {
    const submissionStatus = await beginMerchantShippingChargeSubmission(
      supabase,
      chargeId,
      token
    );
    if (submissionStatus !== 'provider_submitting') {
      throw new OrderShipmentBookingError(
        submissionStatus === 'refunded'
          ? 'This shipping charge was refunded. Get a new quote before booking again.'
          : 'Unable to begin shipment submission.',
        409,
        submissionStatus === 'refunded'
          ? 'MERCHANT_WALLET_CHARGE_REFUNDED'
          : 'MERCHANT_WALLET_SUBMISSION_FAILED'
      );
    }
  }
  await completeMerchantShippingCharge(
    supabase,
    chargeId,
    token,
    existingShipment.shipmentId
  );
  return existingShipment;
}

export async function completePendingWalletExistingShipment(
  supabase: SupabaseClient,
  chargeId: string,
  token: string,
  chargeStatus: string,
  pendingExistingShipment: BookOrderShipmentResult,
  releaseLock?: ReleaseLock
): Promise<BookOrderShipmentResult> {
  try {
    return await finalizeWalletFundedExistingShipment(
      supabase,
      chargeId,
      token,
      chargeStatus,
      pendingExistingShipment
    );
  } catch (error) {
    if (releaseLock && shouldReleaseBookingLock(error)) {
      try {
        await releaseLock();
      } catch (releaseError) {
        console.error(
          'Failed to release shipment booking lock after existing-shipment completion error:',
          releaseError
        );
      }
    }
    throw error;
  }
}
