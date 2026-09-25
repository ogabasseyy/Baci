import { describe, expect, it } from 'vitest';
import { jumiaExportProductVariationSchema } from './export-product-variation';

describe('jumiaExportProductVariationSchema', () => {
  it('parses a valid variation and applies the default currency', () => {
    expect(
      jumiaExportProductVariationSchema.parse({
        sellerSku: ' SKU-1 ',
        price: 5000,
        stock: 0,
        attributes: [{ id: 'color', value: 'black' }],
      })
    ).toEqual({
      sellerSku: 'SKU-1',
      price: 5000,
      currency: 'NGN',
      stock: 0,
      attributes: [{ id: 'color', value: 'black' }],
    });
  });

  it('accepts the smallest positive price and zero stock', () => {
    expect(
      jumiaExportProductVariationSchema.safeParse({
        sellerSku: 'SKU-1',
        price: Number.MIN_VALUE,
        stock: 0,
      }).success
    ).toBe(true);
  });

  it.each([
    { sellerSku: '', price: 1 },
    { sellerSku: 'SKU-1', price: 0 },
    { sellerSku: 'SKU-1', price: -1 },
    { sellerSku: 'SKU-1', price: 1, stock: -1 },
    { sellerSku: 'SKU-1', price: 1, attributes: [{ id: 'color' }] },
  ])('rejects invalid variation payloads', (input) => {
    expect(jumiaExportProductVariationSchema.safeParse(input).success).toBe(
      false
    );
  });
});
