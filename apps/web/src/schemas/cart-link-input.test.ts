import { describe, expect, it } from 'vitest';
import { cartLinkInputSchema } from './cart-link-input';

describe('cartLinkInputSchema', () => {
  it('defaults an omitted quantity to 1', () => {
    const result = cartLinkInputSchema.safeParse({ product_id: 'prod-1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.quantity).toBe(1);
  });

  it('accepts an explicit quantity', () => {
    expect(
      cartLinkInputSchema.safeParse({ product_id: 'prod-1', quantity: 3 })
        .success
    ).toBe(true);
  });

  it.each([0, 11, 2.5])('rejects out-of-range quantity %s', (quantity) => {
    expect(
      cartLinkInputSchema.safeParse({ product_id: 'prod-1', quantity }).success
    ).toBe(false);
  });

  it('rejects an empty product id', () => {
    expect(cartLinkInputSchema.safeParse({ product_id: '' }).success).toBe(
      false
    );
  });

  it('rejects an overlong product id', () => {
    expect(
      cartLinkInputSchema.safeParse({ product_id: 'p'.repeat(81) }).success
    ).toBe(false);
  });
});
