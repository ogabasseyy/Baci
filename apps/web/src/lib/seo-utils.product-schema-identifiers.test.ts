import { describe, expect, it } from 'vitest';
import { generateProductSchema } from './seo-utils';
import { makeSeoProduct } from './seo-utils-product-schema-test-helper';

describe('generateProductSchema identifiers', () => {
  it('trims parent identifiers and keeps valid variant strings ahead of numeric collisions', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        gtin: ' 00012345678901 ',
        mpn: '  ',
        variants: [
          {
            id: 'variant-1',
            product_id: 'test-123',
            merchant_id: 'm1',
            attributes: {
              gtin: ' VARIANT-GTIN ',
              ' GTIN ': 123,
              mpn: false,
            } as unknown as Record<string, string>,
            stock_quantity: 1,
          },
        ],
      }),
      'TestStore',
      'USD',
      'NG'
    );
    const [variant] = schema.hasVariant as Record<string, unknown>[];

    expect(schema).toMatchObject({
      gtin: '00012345678901',
      gtin14: '00012345678901',
    });
    expect(schema).not.toHaveProperty('mpn');
    expect(variant).toMatchObject({ gtin: 'VARIANT-GTIN' });
    expect(variant).not.toHaveProperty('mpn');
  });
});
