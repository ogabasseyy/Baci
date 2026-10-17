import {
  ConfirmCheckoutResponseSchema,
  WalletOnlyVtuResponseSchema,
} from './vtu-checkout-response-schemas';

describe('vtu checkout response schemas', () => {
  it('parses wallet-only checkout success responses', () => {
    expect(
      WalletOnlyVtuResponseSchema.parse({
        status: 'successful',
        reference: 'VTU-123',
        amount: 1000,
      })
    ).toMatchObject({ reference: 'VTU-123' });
  });

  it('rejects unsupported confirmation statuses', () => {
    expect(() =>
      ConfirmCheckoutResponseSchema.parse({
        status: 'failed',
        reference: 'VTU-123',
      })
    ).toThrow();
  });
});
