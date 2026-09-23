import type { SupabaseClient } from '@supabase/supabase-js';
import { assertWalletExistingShipmentReusableOrRelease } from './assert-wallet-existing-shipment-reusable';
import type { BookOrderShipmentResult } from './book-order-shipment';
import {
  cleanupPreSubmissionReservation,
  hasActiveMerchantShippingCharge,
} from './book-wallet-funded-reservation-cleanup';
import {
  completePendingWalletExistingShipment,
  readPendingWalletExistingShipment,
} from './finalize-wallet-funded-existing-shipment';
import {
  beginMerchantShippingChargeSubmission,
  completeMerchantShippingCharge,
  markMerchantShippingChargeForReconciliation,
  refundMerchantShippingCharge,
  reserveMerchantShippingCharge,
} from './merchant-shipping-charge';
import { shouldReleaseBookingLock } from './order-shipment-booking-lock-errors';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';
import { recoverBookedWalletShipment } from './recover-booked-wallet-shipment';

type ReleaseLock = () => Promise<void>;
type PrepareQuote = () => Promise<string>;
type BookShipment = (quoteId?: string) => Promise<BookOrderShipmentResult>;
type ReadExistingShipment = () => Promise<BookOrderShipmentResult | null>;
type ChargeReservation = Awaited<
  ReturnType<typeof reserveMerchantShippingCharge>
>;
export async function bookWalletFundedOrderShipment(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  quoteId: string,
  book: BookShipment,
  releaseLock?: ReleaseLock,
  prepareQuote?: PrepareQuote,
  readExistingShipment?: ReadExistingShipment
): Promise<BookOrderShipmentResult> {
  // Wallet RPCs enforce merchant-owner or orders.fulfill/orders.edit access.
  if (!merchantId) {
    throw new OrderShipmentBookingError(
      'Merchant context is required.',
      400,
      'MERCHANT_NOT_FOUND'
    );
  }
  let pendingExistingShipment: BookOrderShipmentResult | null = null;
  if (readExistingShipment) {
    pendingExistingShipment = await readPendingWalletExistingShipment(
      readExistingShipment,
      releaseLock
    );
    if (pendingExistingShipment) {
      await assertWalletExistingShipmentReusableOrRelease(
        pendingExistingShipment,
        quoteId,
        releaseLock
      );
    }
  }
  let preparedQuoteId = quoteId;
  let reservation: ChargeReservation | undefined;
  const reservedChargeState = await hasActiveMerchantShippingCharge(
    supabase,
    orderId,
    quoteId
  );
  if (reservedChargeState !== false) {
    reservation = await reserveMerchantShippingCharge(
      supabase,
      orderId,
      quoteId
    );
  }
  const resumedExistingReservation = Boolean(reservation);
  // Never refresh/replace quotes while a provider submission may already be live.
  // cleanupPreSubmissionReservation refunds shipment_id-null charges, including
  // provider_submitting, which can double-book if GIGL already accepted.
  const resumeProviderSubmitting =
    reservation?.charge.status === 'provider_submitting';
  if (
    prepareQuote &&
    !pendingExistingShipment &&
    !resumeProviderSubmitting &&
    (!reservation || reservedChargeState !== false)
  ) {
    try {
      preparedQuoteId = await prepareQuote();
    } catch (error) {
      if (reservation && reservation.charge.status === 'reserved') {
        await cleanupPreSubmissionReservation(
          supabase,
          reservation,
          error instanceof OrderShipmentBookingError
            ? error.code
            : 'QUOTE_REFRESH_FAILED',
          releaseLock
        );
      } else if (releaseLock) {
        try {
          await releaseLock();
        } catch (releaseError) {
          console.error(
            'Failed to release shipment booking lock after quote preparation error:',
            releaseError
          );
        }
      }
      throw error;
    }
  }
  if (!reservation) {
    reservation = await reserveMerchantShippingCharge(
      supabase,
      orderId,
      preparedQuoteId
    );
  }
  if (
    resumedExistingReservation &&
    reservation.charge.status === 'reserved' &&
    preparedQuoteId !== quoteId
  ) {
    const quoteChangedError = new OrderShipmentBookingError(
      'The shipping quote changed or expired. Please get a new quote and confirm shipping before booking.',
      409,
      'MERCHANT_WALLET_QUOTE_RECONFIRM_REQUIRED'
    );
    await cleanupPreSubmissionReservation(
      supabase,
      reservation,
      quoteChangedError.code,
      releaseLock
    );
    throw quoteChangedError;
  }
  const { charge, token } = reservation;
  if (charge.status === 'booked') {
    try {
      return await recoverBookedWalletShipment(
        supabase,
        merchantId,
        orderId,
        charge
      );
    } catch (error) {
      if (releaseLock && shouldReleaseBookingLock(error)) {
        try {
          await releaseLock();
        } catch (releaseError) {
          console.error(
            'Failed to release shipment booking lock after booked-charge recovery error:',
            releaseError
          );
        }
      }
      throw error;
    }
  }
  if (charge.status === 'refunded') {
    if (releaseLock) {
      try {
        await releaseLock();
      } catch (releaseError) {
        console.error(
          'Failed to release shipment booking lock after a refunded wallet charge:',
          releaseError
        );
      }
    }
    throw new OrderShipmentBookingError(
      'This wallet shipping charge was refunded. Please get a new quote before booking.',
      409,
      'MERCHANT_WALLET_CHARGE_REFUNDED'
    );
  }
  if (charge.status === 'needs_reconciliation') {
    throw new OrderShipmentBookingError(
      'This shipment booking already requires reconciliation.',
      409,
      'MERCHANT_WALLET_BOOKING_NOT_RETRYABLE'
    );
  }
  if (pendingExistingShipment) {
    return completePendingWalletExistingShipment(
      supabase,
      charge.chargeId,
      token,
      charge.status,
      pendingExistingShipment,
      releaseLock
    );
  }
  if (charge.status === 'provider_submitting') {
    throw new OrderShipmentBookingError(
      'Shipment booking is already in progress.',
      409,
      'SHIPMENT_BOOKING_IN_PROGRESS'
    );
  }
  let providerSubmissionStarted = false;
  try {
    const submissionStatus = await beginMerchantShippingChargeSubmission(
      supabase,
      charge.chargeId,
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
    providerSubmissionStarted = true;
    const shipment = await book(preparedQuoteId);
    await completeMerchantShippingCharge(
      supabase,
      charge.chargeId,
      token,
      shipment.shipmentId
    );
    return shipment;
  } catch (error) {
    // A failed submission transition happens before the provider booking
    // callback runs, so the reservation is safe to refund and the lock can be
    // released even when the RPC error is otherwise ambiguous.
    const definitive =
      !providerSubmissionStarted || shouldReleaseBookingLock(error);
    if (definitive) {
      await refundMerchantShippingCharge(
        supabase,
        charge.chargeId,
        token,
        error instanceof OrderShipmentBookingError
          ? error.code
          : 'BOOKING_REJECTED'
      );
      if (releaseLock) await releaseLock();
    } else {
      await markMerchantShippingChargeForReconciliation(
        supabase,
        charge.chargeId,
        token,
        error instanceof OrderShipmentBookingError
          ? error.code
          : 'UNKNOWN_PROVIDER_FAILURE',
        error instanceof OrderShipmentBookingError
          ? error.providerReference
          : undefined
      );
    }
    throw error;
  }
}
