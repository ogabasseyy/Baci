import { describe, expect, it } from 'vitest';
import { prefundedCardCheckoutProviderResponseSchemas as schemas } from './prefunded-card-checkout-provider';

describe('prefunded card checkout provider response schemas', () => {
  it('accepts Paystack envelopes while leaving provider fields for strict adapter checks', () => {
    expect(
      schemas.initialize.parse({
        status: true,
        data: { reference: 'pvb-first-ref', authorization_url: 'url' },
        message: 'success',
      }).status
    ).toBe(true);
    expect(
      schemas.verify.parse({ status: true, data: { status: 'success' } }).data
    ).toEqual({ status: 'success' });
  });

  it('rejects malformed top-level provider envelopes', () => {
    expect(
      schemas.initialize.safeParse({ status: 'true', data: {} }).success
    ).toBe(false);
    expect(schemas.verify.safeParse(null).success).toBe(false);
  });
});
