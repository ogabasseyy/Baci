import { describe, expect, it } from 'vitest';
import { generateProductSchema } from './seo-utils';
import { makeSeoProduct as makeProduct } from './seo-utils-product-schema-test-helper';

describe('generateProductSchema identifiers', () => {
  it('uses each variant manufacturer identifier ahead of conflicting parent values', () => {
    const parentGtin = '00000000000011';
    const schema = generateProductSchema(
      makeProduct({
        gtin: parentGtin,
        mpn: 'PARENT-MODEL',
        variants: [
          {
            id: 'variant-red',
            product_id: 'test-123',
            merchant_id: 'm1',
            attributes: {
              color: 'Red',
              gtin: ' 00000000000021 ',
              mpn: ' MODEL-RED ',
            },
            stock_quantity: 1,
          },
          {
            id: 'variant-blue',
            product_id: 'test-123',
            merchant_id: 'm1',
            attributes: {
              color: 'Blue',
              gtin: '00000000000022',
              mpn: 'MODEL-BLUE',
            },
            stock_quantity: 1,
          },
        ],
      }),
      'TestStore',
      'NGN',
      'NG'
    );
    const variants = schema.hasVariant as Record<string, unknown>[];

    expect(schema.gtin).toBe(parentGtin);
    expect(variants.map(({ gtin, mpn }) => ({ gtin, mpn }))).toEqual([
      { gtin: '00000000000021', mpn: 'MODEL-RED' },
      { gtin: '00000000000022', mpn: 'MODEL-BLUE' },
    ]);
  });

  it('retains parent manufacturer identifiers when variant attributes are absent or blank', () => {
    const schema = generateProductSchema(
      makeProduct({
        gtin: '00000000000011',
        mpn: 'PARENT-MODEL',
        variants: [
          {
            id: 'variant-no-identifiers',
            product_id: 'test-123',
            merchant_id: 'm1',
            attributes: { color: 'Red' },
            stock_quantity: 1,
          },
          {
            id: 'variant-blank-identifiers',
            product_id: 'test-123',
            merchant_id: 'm1',
            attributes: { gtin: '   ', mpn: '' },
            stock_quantity: 1,
          },
        ],
      }),
      'TestStore',
      'NGN',
      'NG'
    );
    const variants = schema.hasVariant as Record<string, unknown>[];

    expect(variants.map(({ gtin, mpn }) => ({ gtin, mpn }))).toEqual([
      { gtin: '00000000000011', mpn: 'PARENT-MODEL' },
      { gtin: '00000000000011', mpn: 'PARENT-MODEL' },
    ]);
  });

  it('trims parent identifiers and keeps valid variant strings ahead of numeric collisions', () => {
    const schema = generateProductSchema(
      makeProduct({
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
