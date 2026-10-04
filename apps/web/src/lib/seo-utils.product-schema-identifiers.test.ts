import { describe, expect, it } from 'vitest';
import {
  generateCollectionPageSchema,
  generateProductSchema,
} from './seo-utils';
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

  it('omits parent manufacturer identifiers from variants when attributes are absent or blank', () => {
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

    expect(schema.gtin).toBe('00000000000011');
    expect(schema.mpn).toBe('PARENT-MODEL');
    expect(variants).toHaveLength(2);
    for (const variant of variants) {
      expect(variant).not.toHaveProperty('gtin');
      expect(variant).not.toHaveProperty('mpn');
    }
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
          {
            id: 'variant-numeric-only',
            product_id: 'test-123',
            merchant_id: 'm1',
            attributes: { gtin: 123 } as unknown as Record<string, string>,
            stock_quantity: 1,
          },
        ],
      }),
      'TestStore',
      'USD',
      'NG'
    );
    const [variant, numericOnlyVariant] = schema.hasVariant as Record<
      string,
      unknown
    >[];

    expect(schema).toMatchObject({
      gtin: '00012345678901',
      gtin14: '00012345678901',
    });
    expect(schema).not.toHaveProperty('mpn');
    expect(variant).toMatchObject({ gtin: 'VARIANT-GTIN' });
    expect(variant).not.toHaveProperty('mpn');
    expect(numericOnlyVariant).not.toHaveProperty('gtin');
    expect(numericOnlyVariant).not.toHaveProperty('mpn');
  });

  it('normalizes CollectionPage parent identifiers and omits blank values', () => {
    const schema = generateCollectionPageSchema({
      name: 'Phones',
      url: 'https://example.com/phones',
      merchantName: 'Example',
      products: [
        makeProduct({
          slug: 'identified-phone',
          image: 'https://example.com/phone.jpg',
          gtin: ' PARENT-GTIN ',
          mpn: ' PARENT-MPN ',
        }),
        makeProduct({
          id: 'blank-product',
          slug: 'blank-phone',
          image: 'https://example.com/blank.jpg',
          gtin: '  ',
          mpn: '\t',
        }),
      ],
    });
    const list = schema.mainEntity as Record<string, unknown>;
    const items = list.itemListElement as Record<string, unknown>[];
    const identified = items[0]?.item as Record<string, unknown>;
    const blank = items[1]?.item as Record<string, unknown>;

    expect(identified).toMatchObject({
      gtin: 'PARENT-GTIN',
      mpn: 'PARENT-MPN',
    });
    expect(blank).not.toHaveProperty('gtin');
    expect(blank).not.toHaveProperty('mpn');
  });
});
