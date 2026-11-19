import { describe, expect, it } from 'vitest';
import { JumiaProductSchema, JumiaProductsResponseSchema } from './catalog';
import { retrievedProduct } from './catalog-products.test-fixtures';

describe('Retrieve Products wire contract', () => {
  it('accepts omitted optional translation properties without filling defaults', () => {
    const product = {
      ...retrievedProduct,
      attributes: [
        {
          ...retrievedProduct.attributes[0],
          translations: [{}, { language: 'FR' }, { value: 'Noir' }],
        },
      ],
    };
    expect(JumiaProductSchema.parse(product)).toEqual(product);
  });

  it('preserves exact nested seller SKU, nullable observations and string codes', () => {
    expect(JumiaProductSchema.parse(retrievedProduct)).toEqual(
      retrievedProduct
    );
  });

  it('does not fabricate optional price, translation or variation attribute fields', () => {
    const product = {
      ...retrievedProduct,
      variations: [
        {
          ...retrievedProduct.variations[0],
          globalPrice: {},
          businessClients: [
            { ...retrievedProduct.variations[0].businessClients[0], price: {} },
          ],
        },
      ],
    };
    expect(JumiaProductSchema.parse(product)).toEqual(product);
  });

  it('preserves populated client observations, sale prices and additional metadata', () => {
    const product = {
      ...retrievedProduct,
      providerMetadata: { revision: 3 },
      variations: [
        {
          ...retrievedProduct.variations[0],
          barcodeEan: 'provider-barcode',
          globalPrice: {
            currency: 'USD',
            value: 200,
            salePrice: {
              value: 150,
              startAt: '2022-08-11T00:00:00Z',
              endAt: '2022-08-22T00:00:00Z',
            },
          },
          businessClients: [
            {
              ...retrievedProduct.variations[0].businessClients[0],
              sku: 'JUMIA-SKU',
              visible: true,
              status: 'ACTIVE',
              visibleUpdatedAt: '2022-05-16T17:14:08.487Z',
              price: {
                currency: 'USD',
                value: 200,
                localCurrency: 'NGN',
                localValue: 9800,
                salePrice: {
                  localValue: 7350,
                  value: 150,
                  startAt: '2022-08-11T00:00:00Z',
                  endAt: '2022-08-22T00:00:00Z',
                },
              },
            },
          ],
        },
      ],
    };
    expect(JumiaProductSchema.parse(product)).toEqual(product);
  });

  it.each([
    'id',
    'parentSku',
    'shop',
    'brand',
    'category',
    'attributeSetId',
    'variations',
  ])('rejects missing product identity %s', (field) => {
    expect(
      JumiaProductSchema.safeParse({ ...retrievedProduct, [field]: undefined })
        .success
    ).toBe(false);
  });

  it.each([
    { id: '' },
    { id: 'not-a-uuid' },
    { sellerSku: undefined },
    { sellerSku: '' },
    { barcodeEan: undefined },
    { globalPrice: undefined },
    { businessClients: undefined },
  ])('rejects malformed required variation evidence %j', (change) => {
    expect(
      JumiaProductSchema.safeParse({
        ...retrievedProduct,
        variations: [{ ...retrievedProduct.variations[0], ...change }],
      }).success
    ).toBe(false);
  });

  it.each([
    { code: undefined },
    { visible: undefined },
    { status: 'UNKNOWN' },
    { qc: { status: 'APPROVED' } },
    { price: { value: '200' } },
  ])('rejects malformed required client observations %j', (change) => {
    expect(
      JumiaProductSchema.safeParse({
        ...retrievedProduct,
        variations: [
          {
            ...retrievedProduct.variations[0],
            businessClients: [
              {
                ...retrievedProduct.variations[0].businessClients[0],
                ...change,
              },
            ],
          },
        ],
      }).success
    ).toBe(false);
  });

  it.each([
    { products: [] },
    { products: [], isLastPage: true },
    { products: [], nextToken: null },
  ])('requires explicit pagination evidence %j', (response) => {
    expect(JumiaProductsResponseSchema.safeParse(response).success).toBe(false);
  });
});
