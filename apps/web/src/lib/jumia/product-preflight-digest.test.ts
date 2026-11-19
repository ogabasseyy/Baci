import { describe, expect, it } from 'vitest';
import { computeJumiaProductPreflightDigest } from './product-preflight-digest';

describe('computeJumiaProductPreflightDigest', () => {
  it('binds exact selected page, source versions, destination, mapping and evidence', () => {
    const input = {
      merchantId: 'merchant',
      integrationId: 'integration',
      shopId: 'shop',
      businessClientCode: 'NG',
      countryCode: 'NG',
      localCurrency: 'NGN',
      selectionId: 'selection',
      sourceCategoryId: 'category',
      sourcePage: { page: 1, limit: 100 },
      products: [
        {
          productId: 'product',
          sourceVersion: 'a'.repeat(64),
          mapping: { category: 4 },
          evidence: { globalPrice: false },
        },
      ],
    };
    const original = computeJumiaProductPreflightDigest(input);
    expect(
      computeJumiaProductPreflightDigest({
        ...input,
        products: [{ ...input.products[0], mapping: { category: 5 } }],
      })
    ).not.toBe(original);
    expect(
      computeJumiaProductPreflightDigest({
        ...input,
        countryCode: 'GH',
      })
    ).not.toBe(original);
    expect(
      computeJumiaProductPreflightDigest({
        ...input,
        localCurrency: 'GHS',
      })
    ).not.toBe(original);
    expect(
      computeJumiaProductPreflightDigest({
        ...input,
        sourcePage: { page: 2, limit: 100 },
      })
    ).not.toBe(original);
    expect(computeJumiaProductPreflightDigest(input)).toBe(original);
  });

  it('omits undefined object properties like JSON.stringify', () => {
    const input = {
      merchantId: 'merchant',
      integrationId: 'integration',
      shopId: 'shop',
      businessClientCode: 'NG',
      countryCode: 'NG',
      localCurrency: 'NGN',
      selectionId: 'selection',
      sourceCategoryId: 'category',
      sourcePage: { page: 1, limit: 100 },
      products: [
        {
          productId: 'product',
          sourceVersion: 'a'.repeat(64),
          mapping: { category: 4, variation: undefined },
          evidence: { globalPrice: false },
        },
      ],
    };
    expect(computeJumiaProductPreflightDigest(input)).toBe(
      computeJumiaProductPreflightDigest({
        ...input,
        products: [
          {
            ...input.products[0],
            mapping: { category: 4 },
          },
        ],
      })
    );
  });
});
