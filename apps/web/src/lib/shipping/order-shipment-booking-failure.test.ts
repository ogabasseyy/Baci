import { describe, expect, it, vi } from 'vitest';
import {
  classifyBookingFailure,
  recordOrderShipmentBookingFailure,
  toBookingFailureResponseError,
} from './order-shipment-booking-failure';
import { shouldReleaseBookingLock } from './order-shipment-booking-lock-errors';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';

function connectError(code: string): Error {
  return Object.assign(new Error('fetch failed'), { cause: { code } });
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

  it('leaves our own refusals untouched', () => {
    const own = new OrderShipmentBookingError('x', 400, 'QUOTE_PRICE_CHANGED');
    expect(toBookingFailureResponseError(own)).toBe(own);
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
    expect(classifyBookingFailure(deep).outcome).toBe('not_submitted');
    expect(
      classifyBookingFailure(
        Object.assign(new Error('boom'), { code: 'ENOTFOUND' })
      ).outcome
    ).toBe('not_submitted');
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
