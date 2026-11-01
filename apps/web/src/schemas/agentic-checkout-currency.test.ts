import { describe, expect, it } from 'vitest';
import { checkoutSessionSchema } from './agentic-checkout';

describe('checkout currency after the Zod security upgrade', () => {
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
