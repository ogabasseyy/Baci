import { describe, expect, it } from 'vitest';
import { LocalAirportDeliveryValidationError } from '@/lib/checkout/local-airport-delivery-validation-error';

describe('LocalAirportDeliveryValidationError', () => {
  it('preserves the client error code and status', () => {
    const error = new LocalAirportDeliveryValidationError(
      'invalid quote',
      'AIRPORT_QUOTE_INVALID',
      400
    );

    expect(error).toMatchObject({
      message: 'invalid quote',
      name: 'LocalAirportDeliveryValidationError',
      code: 'AIRPORT_QUOTE_INVALID',
      status: 400,
    });
  });
});
