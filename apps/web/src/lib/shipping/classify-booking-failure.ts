import {
  BOOKED_SHIPMENT_NOT_SAVED_CODE,
  BOOKING_FAILURE_MAX_CODE_LENGTH,
  BOOKING_FAILURE_MAX_MESSAGE_LENGTH,
  GIGL_BOOKING_TIMEOUT_MESSAGE,
  GIGL_INTERNATIONAL_BOOKING_TIMEOUT_MESSAGE,
} from './booking-failure-constants';
import type { ClassifiedBookingFailure } from './booking-failure-types';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';
import { ProviderBookingTimeoutError } from './provider-booking-timeout-error';
import { isProviderNeverReachedError } from './provider-never-reached';
import { ShippingBookingRejectedError } from './types';

/** A call that may have reached GIG but never answered (also when wrapped). */
function isProviderTimeoutError(error: unknown): boolean {
  // Only GIG's own booking timeouts: a database or client-abort timeout says
  // nothing about whether GIG booked the parcel.
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current instanceof Error; depth += 1) {
    if (
      current instanceof ProviderBookingTimeoutError ||
      current.message.startsWith(GIGL_BOOKING_TIMEOUT_MESSAGE) ||
      current.message.startsWith(GIGL_INTERNATIONAL_BOOKING_TIMEOUT_MESSAGE)
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function classifyBookingFailure(
  error: unknown
): ClassifiedBookingFailure {
  if (error instanceof OrderShipmentBookingError) {
    const base = {
      code: error.code.slice(0, BOOKING_FAILURE_MAX_CODE_LENGTH),
      message: error.message.slice(0, BOOKING_FAILURE_MAX_MESSAGE_LENGTH),
      httpStatus: error.status,
      providerReference: error.providerReference?.slice(
        0,
        BOOKING_FAILURE_MAX_CODE_LENGTH * 2
      ),
    };
    if (
      error.code === 'GIGL_BOOKING_TIMED_OUT_BEFORE_SUBMIT' ||
      // The wallet submission could not start, so the carrier was never called.
      error.code === 'MERCHANT_WALLET_SUBMISSION_FAILED'
    ) {
      // Nothing was submitted to the carrier.
      return { ...base, outcome: 'not_submitted' };
    }
    if (error.code === 'MERCHANT_WALLET_COMPLETION_FAILED') {
      // The parcel is booked and saved; only the wallet charge is unfinished.
      return { ...base, outcome: 'booked_unreconciled' };
    }
    return {
      ...base,
      outcome:
        error.code === BOOKED_SHIPMENT_NOT_SAVED_CODE ||
        error.code === 'SHIPMENT_SAVE_FAILED' ||
        // The carrier accepted the parcel before the payment was refunded.
        error.code === 'ORDER_REFUNDED_AFTER_BOOKING'
          ? 'booked_not_saved'
          : 'rejected',
    };
  }
  const message = (
    error instanceof Error ? error.message : String(error)
  ).slice(0, BOOKING_FAILURE_MAX_MESSAGE_LENGTH);
  if (error instanceof ShippingBookingRejectedError) {
    // The carrier answered and refused (e.g. a declined payment): a clear
    // rejection, not an unexpected bug.
    return {
      code: 'PROVIDER_REJECTED',
      message,
      httpStatus: null,
      outcome: 'rejected',
    };
  }
  if (isProviderNeverReachedError(error)) {
    return {
      code: 'PROVIDER_UNREACHABLE',
      message,
      httpStatus: null,
      outcome: 'not_submitted',
    };
  }
  if (!isProviderTimeoutError(error)) {
    return {
      code: 'BOOKING_UNEXPECTED_ERROR',
      message,
      httpStatus: null,
      outcome: 'unexpected',
    };
  }
  return {
    code: 'PROVIDER_UNCONFIRMED',
    message,
    httpStatus: null,
    outcome: 'provider_unconfirmed',
  };
}
