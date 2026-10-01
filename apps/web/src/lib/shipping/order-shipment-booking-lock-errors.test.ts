import { describe, expect, it } from 'vitest';
import { shouldReleaseBookingLock } from './order-shipment-booking-lock-errors';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';

describe('shouldReleaseBookingLock', () => {
  it('releases a lock for recoverable booking errors only', () => {
    expect(
      shouldReleaseBookingLock(
        new OrderShipmentBookingError(
          'Requote required',
          400,
          'QUOTE_NOT_FOUND'
        )
      )
    ).toBe(true);
    expect(
      shouldReleaseBookingLock(
        new OrderShipmentBookingError('Provider failed', 500, 'PROVIDER_ERROR')
      )
    ).toBe(false);
    expect(shouldReleaseBookingLock(new Error('Provider failed'))).toBe(false);
  });

  it('releases locks for pre-provider quote and origin failures', () => {
    for (const code of [
      'QUOTE_REFRESH_PERSIST_FAILED',
      'QUOTE_ORDER_MISMATCH',
      'QUOTE_METADATA_LOOKUP_FAILED',
      'QUOTE_REFRESH_ORDER_UPDATE_FAILED',
      'MERCHANT_WALLET_QUOTE_RECONFIRM_REQUIRED',
      'MERCHANT_WALLET_INSUFFICIENT',
      'QUOTE_PRICE_CHANGED',
      'MERCHANT_LOOKUP_FAILED',
      'MERCHANT_SENDER_REQUIRED',
      'MERCHANT_ORIGIN_MISSING',
      'INTERNATIONAL_QUOTE_SENDER_MISSING',
      'SHIPPING_QUOTE_RECEIVER_MISMATCH',
      'SHIPPING_QUOTE_ITEMS_MISMATCH',
      'MERCHANT_WALLET_CHARGE_REFUNDED',
      'MERCHANT_WALLET_BOOKED_SHIPMENT_MISSING',
      'GIGL_STATION_RESOLUTION_FAILED',
      'GIGL_AUTHENTICATION_FAILED',
    ]) {
      expect(
        shouldReleaseBookingLock(
          new OrderShipmentBookingError('Booking cannot continue', 400, code)
        )
      ).toBe(true);
    }
  });
});
