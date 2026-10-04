import { describe, expect, it } from 'vitest';
import { flattenJumiaImportProducts } from './flatten-jumia-import-products';

describe('flattenJumiaImportProducts', () => {
  it('flattens priced variations and counts unusable variations', () => {
    const result = flattenJumiaImportProducts([
      {
        id: 'jumia-product-1',
        name: 'Product',
        description: '<p>Description</p>',
        images: [{ url: 'https://img.example/1.jpg' }, { url: null }],
        variations: [
          { sellerSku: 'SKU-1', globalPrice: { value: 1200 } },
          { sellerSku: '', globalPrice: { value: 1000 } },
          { sellerSku: 'SKU-2', globalPrice: null },
        ],
      },
    ] as never);

    expect(result.flatEntries).toEqual([
      {
        sku: 'SKU-1',
        name: 'Product',
        description: '<p>Description</p>',
        price: 1200,
        images: ['https://img.example/1.jpg'],
        productId: 'jumia-product-1',
      },
    ]);
    expect(result.skippedNoSkuCount).toBe(1);
    expect(result.missingPriceCount).toBe(1);
  });

  it('returns an empty import set for an empty catalog', () => {
    expect(flattenJumiaImportProducts([])).toEqual({
      flatEntries: [],
      skippedNoSkuCount: 0,
      missingPriceCount: 0,
    });
  });
});
