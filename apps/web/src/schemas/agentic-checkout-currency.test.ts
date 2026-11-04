import { describe, expect, it } from 'vitest';
import { checkoutSessionSchema } from './agentic-checkout';
import { agenticCheckoutCurrencySchema } from './agentic-checkout-currency';

describe('checkout currency after the Zod security upgrade', () => {
  it('shares the default and normalization through the currency schema', () => {
    expect(agenticCheckoutCurrencySchema.parse(undefined)).toBe('NGN');
    expect(agenticCheckoutCurrencySchema.parse(' usd ')).toBe('USD');
    expect(agenticCheckoutCurrencySchema.safeParse('invalid').success).toBe(
      false
    );
    expect(agenticCheckoutCurrencySchema.safeParse(null).success).toBe(false);
  });
  it.each([
    { items: [{ id: 'test-product', quantity: 1 }] },
    { cart_id: 'test-cart' },
  ])('defaults omitted currency to NGN for %j', (input) => {
    expect(checkoutSessionSchema.parse(input).currency).toBe('NGN');
  });
  it('normalizes explicit ISO codes and rejects malformed codes', () => {
    expect(
      checkoutSessionSchema.parse({ cart_id: 'test-cart', currency: ' usd ' })
        .currency
    ).toBe('USD');
    expect(
      checkoutSessionSchema.safeParse({
        cart_id: 'test-cart',
        currency: 'invalid',
      }).success
    ).toBe(false);
  });
});
