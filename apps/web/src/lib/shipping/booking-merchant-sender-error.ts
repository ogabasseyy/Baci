import { OrderShipmentBookingError } from './order-shipment-booking-utils';
import type { ResolveBookingMerchantSenderResult } from './resolve-booking-merchant-sender';

type FailedMerchantSenderResult = Extract<
  ResolveBookingMerchantSenderResult,
  { ok: false }
>;

/** Maps a failed merchant-origin lookup onto order-booking error codes. */
export function toBookingMerchantSenderError(
  result: FailedMerchantSenderResult
): OrderShipmentBookingError {
  if (result.code) {
    return new OrderShipmentBookingError(
      result.error,
      result.status,
      result.code
    );
  }
  if (result.status === 400) {
    return new OrderShipmentBookingError(
      'Merchant shipping origin is not configured.',
      400,
      'MERCHANT_ORIGIN_MISSING'
    );
  }
  if (result.status === 404) {
    return new OrderShipmentBookingError(
      'Merchant details not found.',
      404,
      'MERCHANT_NOT_FOUND'
    );
  }
  return new OrderShipmentBookingError(
    'Failed to resolve merchant shipping origin. Please try again.',
    result.status,
    'MERCHANT_LOOKUP_FAILED'
  );
}
