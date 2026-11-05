import { describe, expect, it } from 'vitest';
import { getVariantSchemaVariesBy } from './product-schema-varies-by';
import type { ProductVariant } from './products';

describe('getVariantSchemaVariesBy', () => {
  it('ignores unsupported and inherited attribute keys', () => {
    const variants: ProductVariant[] = [
      {
        id: '1',
        product_id: 'p',
        merchant_id: 'm',
        stock_quantity: 1,
        attributes: { constructor: 'x', material: 'leather', pattern: 'plain' },
      },
    ];
    expect(getVariantSchemaVariesBy(variants)).toEqual([]);
  });
  it('omits dimensions missing from a variant', () => {
    const variants: ProductVariant[] = [
      {
        id: '1',
        product_id: 'p',
        merchant_id: 'm',
        stock_quantity: 1,
        attributes: { color: 'Silver', storage: '512GB' },
      },
      {
        id: '2',
        product_id: 'p',
        merchant_id: 'm',
        stock_quantity: 1,
        attributes: {},
      },
    ];
    expect(getVariantSchemaVariesBy(variants)).toEqual([]);
  });
  it.each([
    [{ color: 'Black', size: '128GB' }, { color: 'White' }, 'color'],
    [{ color: 'Black', size: '128GB' }, { size: '256GB' }, 'size'],
  ] as const)('keeps the independently complete dimension', (first, second, expected) => {
    const variants: ProductVariant[] = [
      {
        id: '1',
        product_id: 'p',
        merchant_id: 'm',
        stock_quantity: 1,
        attributes: first,
      },
      {
        id: '2',
        product_id: 'p',
        merchant_id: 'm',
        stock_quantity: 1,
        attributes: second,
      },
    ];
    expect(getVariantSchemaVariesBy(variants)).toEqual([
      `https://schema.org/${expected}`,
    ]);
  });
  it('deduplicates supported dimensions present on every variant', () => {
    const variants: ProductVariant[] = [
      {
        id: '1',
        product_id: 'p',
        merchant_id: 'm',
        stock_quantity: 1,
        attributes: { colour: 'Silver', storage: '512GB', ram: '16GB' },
      },
      {
        id: '2',
        product_id: 'p',
        merchant_id: 'm',
        stock_quantity: 1,
        attributes: { color: 'Black', size: '256GB' },
      },
    ];
    expect(getVariantSchemaVariesBy(variants)).toEqual([
      'https://schema.org/color',
      'https://schema.org/size',
    ]);
  });
});
