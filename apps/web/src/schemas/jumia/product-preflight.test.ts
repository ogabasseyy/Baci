import { describe, expect, it } from 'vitest';
import { jumiaProductPreflightRequestSchema } from './product-preflight';

describe('Jumia preflight request schema', () => {
  it('rejects caller-supplied trusted evidence and duplicate source products', () => {
    const productId = 'a6a6dd33-a9d8-4f71-a668-a95d33578f21';
    const mapping = {
      productId,
      category: { code: 12, name: 'Games' },
      brand: { code: 3, name: 'Brand' },
      attributeSetId: 'a6a6dd33-a9d8-4f71-a668-a95d33578f22',
      attributes: {},
      bullets: ['one', 'two', 'three', 'four'],
      categoryConfirmed: true,
    };
    const request = {
      merchantId: 'a6a6dd33-a9d8-4f71-a668-a95d33578f23',
      integrationId: 'a6a6dd33-a9d8-4f71-a668-a95d33578f24',
      businessClientCode: 'NG',
      selectionId: 'a6a6dd33-a9d8-4f71-a668-a95d33578f25',
      sourceCategoryId: 'a6a6dd33-a9d8-4f71-a668-a95d33578f26',
      sourcePage: { page: 1, limit: 100 },
      products: [{ productId, sourceVersion: 'a'.repeat(64) }],
      mappings: [mapping],
    };
    expect(
      jumiaProductPreflightRequestSchema.safeParse({
        ...request,
        trustedGlobalPrice: true,
      }).success
    ).toBe(false);
    expect(
      jumiaProductPreflightRequestSchema.safeParse({
        ...request,
        products: [...request.products, ...request.products],
      }).success
    ).toBe(false);
    expect(
      jumiaProductPreflightRequestSchema.safeParse({
        ...request,
        mappings: [
          {
            ...mapping,
            category: { ...mapping.category, activeLeaf: true },
          },
        ],
      }).success
    ).toBe(false);
    expect(
      jumiaProductPreflightRequestSchema.safeParse({
        ...request,
        mappings: [
          {
            ...mapping,
            variation: { sourceAttributeName: 'storage' },
          },
        ],
      }).success
    ).toBe(true);
  });
});
