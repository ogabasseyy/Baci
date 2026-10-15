import { describe, expect, it } from 'vitest';
import { shippingCheckoutRecoveryConfirmationSchema } from './shipping-checkout-recovery-response';

const confirmation = {
  quoteId: '70000000-0000-4000-8000-000000000001',
  confirmed: true,
};

describe('shippingCheckoutRecoveryConfirmationSchema', () => {
  it('parses a confirmed quote and strips unrelated fields', () => {
    expect(
      shippingCheckoutRecoveryConfirmationSchema.parse({
        ...confirmation,
        internal: 'hidden',
      })
    ).toEqual(confirmation);
  });

  it.each([
    null,
    {},
    { ...confirmation, quoteId: undefined },
    { ...confirmation, quoteId: 'invalid' },
    { ...confirmation, quoteId: 123 },
    { ...confirmation, confirmed: undefined },
    { ...confirmation, confirmed: false },
    { ...confirmation, confirmed: 'true' },
  ])('rejects invalid confirmation %j', (payload) => {
    expect(
      shippingCheckoutRecoveryConfirmationSchema.safeParse(payload).success
    ).toBe(false);
  });
});
