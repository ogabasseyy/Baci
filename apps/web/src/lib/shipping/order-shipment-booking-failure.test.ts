import { describe, expect, it, vi } from 'vitest';
import {
  classifyBookingFailure,
  ProviderBookingTimeoutError,
  recordOrderShipmentBookingFailure,
  tagProviderCallError,
  toBookingFailureResponseError,
} from './order-shipment-booking-failure';
import { shouldReleaseBookingLock } from './order-shipment-booking-lock-errors';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';
import { ShippingBookingRejectedError } from './types';

/** A connection error as the provider-call boundary hands it on (tagged). */
function connectError(code: string): Error {
  const error = Object.assign(new Error('fetch failed'), { cause: { code } });
  tagProviderCallError(error);
  return error;
}

describe('classifyBookingFailure', () => {
  it('treats a refusal by our own checks as rejected', () => {
    const result = classifyBookingFailure(
      new OrderShipmentBookingError('Price changed', 400, 'QUOTE_PRICE_CHANGED')
    );
    expect(result).toMatchObject({
      code: 'QUOTE_PRICE_CHANGED',
      outcome: 'rejected',
      httpStatus: 400,
    });
  });

  it('treats a GIG timeout as unconfirmed so the parcel is not booked twice', () => {
    const result = classifyBookingFailure(new Error('GIGL booking timed out'));
    expect(result).toMatchObject({
      code: 'PROVIDER_UNCONFIRMED',
      outcome: 'provider_unconfirmed',
    });
    expect(result.message).toContain('GIGL booking timed out');
  });

  it('treats a connection that never opened as not submitted', () => {
    expect(classifyBookingFailure(connectError('ECONNREFUSED'))).toMatchObject({
      code: 'PROVIDER_UNREACHABLE',
      outcome: 'not_submitted',
    });
  });

  it('does not call an unrelated bug an unconfirmed GIG booking', () => {
    expect(classifyBookingFailure(new Error('x is undefined'))).toMatchObject({
      code: 'BOOKING_UNEXPECTED_ERROR',
      outcome: 'unexpected',
    });
    expect(
      toBookingFailureResponseError(new Error('x is undefined'))
    ).toBeInstanceOf(Error);
  });

  it('treats ENETUNREACH as never reached', () => {
    expect(classifyBookingFailure(connectError('ENETUNREACH')).outcome).toBe(
      'not_submitted'
    );
  });

  it('answers an unreachable provider with a coded 503', () => {
    expect(
      toBookingFailureResponseError(connectError('ECONNREFUSED'))
    ).toMatchObject({
      status: 503,
      code: 'PROVIDER_UNREACHABLE',
    });
  });

  it('does not treat a database timeout as an unconfirmed GIG booking', () => {
    expect(
      classifyBookingFailure(
        new Error('canceling statement due to statement timeout')
      ).outcome
    ).toBe('unexpected');
  });

  it('caps very long messages', () => {
    const result = classifyBookingFailure(new Error('x'.repeat(2000)));
    expect(result.message.length).toBeLessThanOrEqual(500);
  });
});

describe('bugfix: retry blocked after a provider connection failure', () => {
  it('releases the booking lock when GIG was never reached', () => {
    expect(shouldReleaseBookingLock(connectError('ENOTFOUND'))).toBe(true);
  });

  it('keeps the lock after a timeout that may have booked the parcel', () => {
    expect(shouldReleaseBookingLock(new Error('GIGL booking timed out'))).toBe(
      false
    );
  });
});

describe('recordOrderShipmentBookingFailure', () => {
  it('stores the failure for the order', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: vi.fn(() => ({ insert })) };
    await recordOrderShipmentBookingFailure(
      supabase as never,
      'm1',
      'o1',
      new Error('GIGL booking timed out'),
      true
    );
    expect(supabase.from).toHaveBeenCalledWith(
      'order_shipment_booking_failures'
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant_id: 'm1',
        order_id: 'o1',
        outcome: 'provider_unconfirmed',
        lock_retained: true,
      })
    );
  });

  it('persists the carrier reference of a booked-but-not-saved failure', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: vi.fn(() => ({ insert })) };
    await recordOrderShipmentBookingFailure(
      supabase as never,
      'm1',
      'o1',
      new OrderShipmentBookingError(
        'booked, not saved',
        500,
        'BOOKED_SHIPMENT_NOT_SAVED',
        'GIGL-123'
      ),
      true
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ provider_reference: 'GIGL-123' })
    );
  });

  it('never throws when storing the failure itself fails', async () => {
    const supabase = {
      from: vi.fn(() => ({
        insert: vi.fn().mockRejectedValue(new Error('db down')),
      })),
    };
    await expect(
      recordOrderShipmentBookingFailure(
        supabase as never,
        'm',
        'o',
        new Error('x'),
        false
      )
    ).resolves.toBeUndefined();
  });
});

describe('bugfix: review follow-ups', () => {
  it('treats the international GIG timeout as unconfirmed too', () => {
    expect(
      classifyBookingFailure(new Error('GIGL international booking timed out'))
        .outcome
    ).toBe('provider_unconfirmed');
  });

  it('finds a never-reached code one level deeper or on the error itself', () => {
    const deep = Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('inner'), {
        cause: { code: 'ECONNREFUSED' },
      }),
    });
    const direct = Object.assign(new Error('boom'), { code: 'ENOTFOUND' });
    tagProviderCallError(deep);
    tagProviderCallError(direct);
    expect(classifyBookingFailure(deep).outcome).toBe('not_submitted');
    expect(classifyBookingFailure(direct).outcome).toBe('not_submitted');
  });

  it('sends wallet-funded merchants to support instead of promising a retry', () => {
    const result = toBookingFailureResponseError(
      new Error('GIGL booking timed out'),
      { walletFunded: true }
    );
    expect(result).toMatchObject({ code: 'SHIPMENT_BOOKING_UNCONFIRMED' });
    expect((result as Error).message).toContain('contact support');
  });
});

describe('bugfix: wrapped timeouts and long codes', () => {
  it('recognises a GIG timeout wrapped in another error', () => {
    const wrapped = new Error('booking failed', {
      cause: new Error('GIGL booking timed out'),
    });
    expect(classifyBookingFailure(wrapped).outcome).toBe(
      'provider_unconfirmed'
    );
  });

  it('shortens a very long error code to fit the table limit', () => {
    const long = new OrderShipmentBookingError('x', 400, 'C'.repeat(100));
    expect(classifyBookingFailure(long).code).toHaveLength(64);
  });
});

describe('bugfix: typed timeout and booked-but-not-saved', () => {
  it('recognises the typed timeout whatever its message says', () => {
    expect(
      classifyBookingFailure(new ProviderBookingTimeoutError('anything'))
        .outcome
    ).toBe('provider_unconfirmed');
  });

  it('records a booked parcel that failed to save as booked_not_saved', () => {
    const error = new OrderShipmentBookingError(
      'x',
      500,
      'BOOKED_SHIPMENT_NOT_SAVED'
    );
    expect(classifyBookingFailure(error).outcome).toBe('booked_not_saved');
  });
});

describe('bugfix: order-route persistence failure is booked_not_saved', () => {
  it('classifies SHIPMENT_SAVE_FAILED as booked_not_saved, not rejected', () => {
    const error = new OrderShipmentBookingError(
      'save failed',
      500,
      'SHIPMENT_SAVE_FAILED'
    );
    expect(classifyBookingFailure(error).outcome).toBe('booked_not_saved');
  });

  it('classifies ORDER_REFUNDED_AFTER_BOOKING as booked_not_saved because the carrier accepted the parcel', () => {
    const error = new OrderShipmentBookingError(
      'refunded',
      409,
      'ORDER_REFUNDED_AFTER_BOOKING'
    );
    expect(classifyBookingFailure(error).outcome).toBe('booked_not_saved');
  });

  it('classifies a carrier refusal (ShippingBookingRejectedError) as rejected, not unexpected', () => {
    expect(
      classifyBookingFailure(
        new ShippingBookingRejectedError('Payment declined')
      )
    ).toMatchObject({ code: 'PROVIDER_REJECTED', outcome: 'rejected' });
  });

  it('bugfix: a connection failure that did not come from the provider call (e.g. a database fetch after booking) is not "never reached"', () => {
    const databaseError = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    });
    expect(classifyBookingFailure(databaseError).outcome).not.toBe(
      'not_submitted'
    );
    expect(shouldReleaseBookingLock(databaseError)).toBe(false);
  });

  it('classifies MERCHANT_WALLET_COMPLETION_FAILED as booked_unreconciled, not rejected', () => {
    const error = new OrderShipmentBookingError(
      'wallet completion failed',
      500,
      'MERCHANT_WALLET_COMPLETION_FAILED'
    );
    expect(classifyBookingFailure(error).outcome).toBe('booked_unreconciled');
  });

  it('classifies a pre-submit GIG timeout as not_submitted', () => {
    const error = new OrderShipmentBookingError(
      'GIG did not respond before the booking was sent.',
      504,
      'GIGL_BOOKING_TIMED_OUT_BEFORE_SUBMIT'
    );
    expect(classifyBookingFailure(error).outcome).toBe('not_submitted');
  });

  it('carries the carrier reference of a booked-but-not-saved failure', () => {
    const error = new OrderShipmentBookingError(
      'booked, not saved',
      500,
      'BOOKED_SHIPMENT_NOT_SAVED',
      'GIGL-123'
    );
    expect(classifyBookingFailure(error)).toMatchObject({
      outcome: 'booked_not_saved',
      providerReference: 'GIGL-123',
    });
  });
});
