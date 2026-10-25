import { describe, expect, it } from 'vitest';
import { getDurableProductSeoText } from './get-durable-product-seo-text';

describe('getDurableProductSeoText price classification', () => {
  it.each([
    'Price: 900, next day delivery',
    'Buy for 350000, free shipping',
  ])('rejects a bare price before a clause comma: %s', (text) => {
    expect(
      getDurableProductSeoText({ text, product: { name: 'Device' } })
    ).toBe('');
  });

  it('rejects a price predicate after removing the product identity', () => {
    expect(
      getDurableProductSeoText({
        text: 'The price of Phone is 999.',
        product: { name: 'Phone' },
      })
    ).toBe('');
  });

  it('preserves percentage composition specifications', () => {
    expect(
      getDurableProductSeoText({
        text: 'Only 100% cotton',
        product: { name: 'Shirt' },
      })
    ).toBe('Only 100% cotton');
  });

  it('rejects a currency-tagged fractional price without a leading zero', () => {
    expect(
      getDurableProductSeoText({
        text: 'Buy for $.99 today',
        product: { name: 'Device' },
      })
    ).toBe('');
  });
});
