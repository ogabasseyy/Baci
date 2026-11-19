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
  options: { walletFunded?: boolean; lockHeld?: boolean } = {}
): unknown {
  const { outcome } = classifyBookingFailure(error);
  if (outcome === 'not_submitted') {
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
