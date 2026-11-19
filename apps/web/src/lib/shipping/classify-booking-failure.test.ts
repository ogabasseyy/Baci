import { describe, expect, it } from 'vitest';
import { classifyBookingFailure } from './classify-booking-failure';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';

describe('classifyBookingFailure outcomes for booking-state codes', () => {
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

  it('classifies MERCHANT_WALLET_COMPLETION_FAILED as booked_unreconciled, not rejected', () => {
    const error = new OrderShipmentBookingError(
      'wallet completion failed',
      500,
      'MERCHANT_WALLET_COMPLETION_FAILED'
    );
    expect(classifyBookingFailure(error).outcome).toBe('booked_unreconciled');
  });

  it('classifies MERCHANT_WALLET_SUBMISSION_FAILED as not_submitted because the carrier was never called', () => {
    const error = new OrderShipmentBookingError(
      'Unable to begin shipment submission.',
      500,
      'MERCHANT_WALLET_SUBMISSION_FAILED'
    );
    expect(classifyBookingFailure(error).outcome).toBe('not_submitted');
  });

  it('classifies a GIG authentication timeout (504) as not_submitted but a bad-credentials failure as rejected', () => {
    expect(
      classifyBookingFailure(
        new OrderShipmentBookingError(
          'GIGL API authentication timed out',
          504,
          'GIGL_AUTHENTICATION_FAILED'
        )
      ).outcome
    ).toBe('not_submitted');
    expect(
      classifyBookingFailure(
        new OrderShipmentBookingError(
          'GIGL API authentication failed',
          502,
          'GIGL_AUTHENTICATION_FAILED'
        )
      ).outcome
    ).toBe('rejected');
  });
});
