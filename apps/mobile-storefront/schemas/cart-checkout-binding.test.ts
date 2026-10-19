import { cartCheckoutBindingSchema } from './cart-checkout-binding';

const valid = {
  cart_id: '11111111-1111-4111-8111-111111111111',
  checkout_session_id: '22222222-2222-4222-8222-222222222222',
  checkout_generation: 1,
  cart_version: 2,
};

describe('cartCheckoutBindingSchema', () => {
  it('accepts a complete binding', () => {
    expect(cartCheckoutBindingSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects non-positive generations and unknown keys', () => {
    expect(
      cartCheckoutBindingSchema.safeParse({ ...valid, cart_version: 0 }).success
    ).toBe(false);
    expect(
      cartCheckoutBindingSchema.safeParse({ ...valid, extra: true }).success
    ).toBe(false);
  });

  it('rejects malformed ids', () => {
    expect(
      cartCheckoutBindingSchema.safeParse({ ...valid, cart_id: 'cart-1' })
        .success
    ).toBe(false);
  });
});
