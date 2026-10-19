import { describe, expect, it } from 'vitest';
import { buildTransactionDiscountLineKey } from './transaction-discount-line-key';

describe('buildTransactionDiscountLineKey', () => {
  it('canonicalizes variant-attribute order', () => {
    const first = buildTransactionDiscountLineKey({
      condition: 'new',
      productId: 'product-1',
      variantAttributes: { Color: 'Blue', Storage: '128GB' },
      variantId: 'variant-1',
    });
    const second = buildTransactionDiscountLineKey({
      condition: 'new',
      productId: 'product-1',
      variantAttributes: { Storage: '128GB', Color: 'Blue' },
      variantId: 'variant-1',
    });

    expect(first).toBe(second);
  });

  it('preserves identity differences and optional defaults', () => {
    const blue = buildTransactionDiscountLineKey({
      productId: 'product-1',
      variantAttributes: { Color: 'Blue' },
      variantId: 'variant-1',
    });
    const green = buildTransactionDiscountLineKey({
      productId: 'product-1',
      variantAttributes: { Color: 'Green' },
      variantId: 'variant-1',
    });
    const omitted = buildTransactionDiscountLineKey({
      productId: 'product-1',
      variantId: null,
    });
    const explicitDefaults = buildTransactionDiscountLineKey({
      condition: null,
      productId: 'product-1',
      variantAttributes: null,
      variantId: null,
    });

    expect(blue).not.toBe(green);
    expect(omitted).toBe('["product-1",null,null,{}]');
    expect(explicitDefaults).toBe(omitted);
  });
});
