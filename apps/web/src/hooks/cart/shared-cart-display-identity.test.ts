import { describe, expect, it } from 'vitest';
import {
  cartItemToIdentity,
  isCartCondition,
} from './shared-cart-display-identity';

describe('display identity normalization', () => {
  it('preserves condition, variants and selected options without changing the source', () => {
    const source = {
      id: 'phone',
      variantId: '128gb',
      condition: 'used',
      selectedColor: 'green',
      selectedStorage: '128GB',
      variantAttributes: { network: '5G' },
    };
    expect(cartItemToIdentity(source)).toEqual({
      productId: 'phone',
      variantId: '128gb',
      condition: 'used',
      options: { network: '5G', color: 'green', storage: '128GB' },
    });
    expect(source.variantAttributes).toEqual({ network: '5G' });
  });
  it('omits unsupported conditions and empty optional identity fields', () => {
    expect(
      cartItemToIdentity({ id: 'phone', condition: 'unsupported' })
    ).toEqual({ productId: 'phone' });
    expect(isCartCondition(undefined)).toBe(false);
  });
});
