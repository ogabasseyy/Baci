import { describe, expect, it } from 'vitest';
import { toBookingMerchantSenderError } from './booking-merchant-sender-error';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';

describe('toBookingMerchantSenderError', () => {
  it('keeps the invalid store phone code and message', () => {
    const error = toBookingMerchantSenderError({
      code: 'MERCHANT_SENDER_PHONE_INVALID',
      error: 'Update your store phone.',
      ok: false,
      status: 400,
    });

    expect(error).toBeInstanceOf(OrderShipmentBookingError);
    expect(error).toMatchObject({
      code: 'MERCHANT_SENDER_PHONE_INVALID',
      message: 'Update your store phone.',
      status: 400,
    });
  });

  it('maps a missing origin, a missing merchant and lookup failures', () => {
    expect(
      toBookingMerchantSenderError({ error: 'x', ok: false, status: 400 })
    ).toMatchObject({
      code: 'MERCHANT_ORIGIN_MISSING',
      message: 'Merchant shipping origin is not configured.',
      status: 400,
    });
    expect(
      toBookingMerchantSenderError({ error: 'x', ok: false, status: 404 })
    ).toMatchObject({
      code: 'MERCHANT_NOT_FOUND',
      message: 'Merchant details not found.',
      status: 404,
    });
    expect(
      toBookingMerchantSenderError({ error: 'x', ok: false, status: 500 })
    ).toMatchObject({
      code: 'MERCHANT_LOOKUP_FAILED',
      message: 'Failed to resolve merchant shipping origin. Please try again.',
      status: 500,
    });
  });
});
