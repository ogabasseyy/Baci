import { classifyBookingFailure } from './classify-booking-failure';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';

/**
 * An unconfirmed provider call (timeout) would otherwise surface as a bare 500.
 * Say plainly why the order is paused and that retrying shortly is expected.
 * `lockHeld` is false when no booking lock was actually acquired, so no pause
 * can be promised.
 */
export function toBookingFailureResponseError(
  error: unknown,
  options: {
    walletFunded?: boolean;
    lockHeld?: boolean;
    /** The lock is still held after cleanup (e.g. the release failed). */
    lockRetained?: boolean;
  } = {}
): unknown {
  const { outcome } = classifyBookingFailure(error);
  if (
    outcome === 'not_submitted' &&
    error instanceof OrderShipmentBookingError &&
    ((error.code === 'GIGL_AUTHENTICATION_FAILED' && error.status !== 504) ||
      // A wallet transition failed, not the carrier: keep its own answer.
      error.code === 'MERCHANT_WALLET_SUBMISSION_FAILED')
  ) {
    // Not a connection problem (a rejected GIG login or a wallet transition):
    // keep the original message instead of telling the merchant to retry,
    // and say so when the lock could not be freed.
    return options.lockRetained
      ? new OrderShipmentBookingError(
          `${error.message} This order is paused for up to 15 minutes; please try again after that.`,
          error.status,
          error.code
        )
      : error;
  }
  if (outcome === 'not_submitted') {
    if (options.lockRetained) {
      // Nothing was booked, but cleanup could not free the lock, so an
      // immediate retry would be refused until it expires.
      return new OrderShipmentBookingError(
        options.walletFunded
          ? 'We could not reach the shipping carrier just now and nothing was booked, but this order is paused for up to 15 minutes. Any wallet charge for this attempt should be returned automatically; check your wallet and contact support if it is missing. After the pause, get a new shipping quote and book again.'
          : 'We could not reach the shipping carrier just now and nothing was booked, but this order is paused for up to 15 minutes. Please try again after that.',
        503,
        'PROVIDER_UNREACHABLE'
      );
    }
    if (options.walletFunded) {
      // The old quote cannot be reused after a wallet-funded attempt. Do not
      // claim the refund finished: it is attempted automatically, not confirmed.
      return new OrderShipmentBookingError(
        'We could not reach the shipping carrier just now. Nothing was booked. Any wallet charge for this attempt should be returned automatically; check your wallet and contact support if it is missing. Please get a new shipping quote and book again.',
        503,
        'PROVIDER_UNREACHABLE'
      );
    }
    return new OrderShipmentBookingError(
      'We could not reach the shipping carrier just now. Nothing was booked; please try again.',
      503,
      'PROVIDER_UNREACHABLE'
    );
  }
  if (outcome !== 'provider_unconfirmed') {
    return error;
  }
  if (options.walletFunded) {
    // The wallet charge is held for reconciliation, so waiting will not help.
    return new OrderShipmentBookingError(
      'The shipping carrier did not confirm this booking in time and your wallet charge is being checked. Please contact support before trying again.',
      503,
      'SHIPMENT_BOOKING_UNCONFIRMED'
    );
  }
  if (options.lockHeld === false) {
    // No lock blocks a retry, so do not promise a pause: ask the merchant to
    // check the carrier first to avoid booking the parcel twice.
    return new OrderShipmentBookingError(
      'The shipping carrier did not confirm this booking in time. To avoid booking the parcel twice, check with the carrier whether it was created before trying again.',
      503,
      'SHIPMENT_BOOKING_UNCONFIRMED'
    );
  }
  return new OrderShipmentBookingError(
    'The shipping carrier did not confirm this booking in time. To avoid booking the parcel twice, this order is paused for up to 15 minutes. Please try again after that.',
    503,
    'SHIPMENT_BOOKING_UNCONFIRMED'
  );
}
