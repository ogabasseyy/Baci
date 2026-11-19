import { describe, expect, it } from 'vitest';
import { tagProviderCallError } from './order-shipment-booking-failure';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';
import { toBookingFailureResponseError } from './to-booking-failure-response-error';

describe('toBookingFailureResponseError', () => {
  it('explains an unconfirmed GIG timeout instead of a bare 500', () => {
    const result = toBookingFailureResponseError(
      new Error('GIGL booking timed out')
    );
    expect(result).toMatchObject({
      status: 503,
      code: 'SHIPMENT_BOOKING_UNCONFIRMED',
    });
  });

  it('bugfix: does not name GIG when an unreachable carrier may be Topship', () => {
    const unreachable = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    });
    tagProviderCallError(unreachable);
    const result = toBookingFailureResponseError(unreachable);
    expect((result as Error).message).not.toMatch(/GIG/);
    expect((result as Error).message).toMatch(/shipping carrier/);
  });

  it('leaves our own refusals untouched', () => {
    const own = new OrderShipmentBookingError('x', 400, 'QUOTE_PRICE_CHANGED');
    expect(toBookingFailureResponseError(own)).toBe(own);
  });
});

describe('bugfix: wallet-funded unreachable booking asks for a new quote', () => {
  it('tells the merchant the charge was refunded and a new quote is needed', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    tagProviderCallError(error);
    const mapped = toBookingFailureResponseError(error, {
      walletFunded: true,
    }) as { message: string; code?: string };
    expect(mapped.code).toBe('PROVIDER_UNREACHABLE');
    expect(mapped.message).toMatch(/new shipping quote/);
  });
});

describe('bugfix: no pause is promised when no booking lock was acquired', () => {
  it('asks the merchant to check the carrier instead of promising a 15-minute pause', () => {
    const mapped = toBookingFailureResponseError(
      new Error('GIGL booking timed out'),
      { lockHeld: false }
    ) as { message: string; code: string };
    expect(mapped.code).toBe('SHIPMENT_BOOKING_UNCONFIRMED');
    expect(mapped.message).not.toMatch(/15 minutes/);
    expect(mapped.message).toMatch(/check with the carrier/);
  });
});

describe('bugfix: unreachable response reflects a lock that could not be freed', () => {
  function unreachable() {
    const error = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    });
    tagProviderCallError(error);
    return error;
  }

  it('tells the merchant to wait when the release failed', () => {
    const mapped = toBookingFailureResponseError(unreachable(), {
      lockRetained: true,
    }) as { message: string; code: string };
    expect(mapped.code).toBe('PROVIDER_UNREACHABLE');
    expect(mapped.message).toMatch(/15 minutes/);
  });

  it('keeps the wallet refund note and asks for a new quote after the pause', () => {
    const mapped = toBookingFailureResponseError(unreachable(), {
      walletFunded: true,
      lockRetained: true,
    }) as { message: string };
    expect(mapped.message).toMatch(/15 minutes/);
    expect(mapped.message).toMatch(/new shipping quote/);
  });

  it('treats a pre-submit GIG timeout as not submitted for a wallet-funded order', () => {
    const mapped = toBookingFailureResponseError(
      new OrderShipmentBookingError(
        'GIG did not respond before the booking was sent.',
        504,
        'GIGL_BOOKING_TIMED_OUT_BEFORE_SUBMIT'
      ),
      { walletFunded: true }
    ) as { message: string; code: string };
    expect(mapped.code).toBe('PROVIDER_UNREACHABLE');
    expect(mapped.message).toMatch(/new shipping quote/);
  });
});
