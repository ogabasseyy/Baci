import { describe, expect, it } from 'vitest';
import type { JumiaCreateProduct } from '@/schemas/jumia/create-product';
import { packJumiaProductFamilies } from './prepare-product-feed-families';

function record(sellerSku: string): JumiaCreateProduct {
  return {
    name: { value: sellerSku },
    description: { value: sellerSku },
    parentSku: sellerSku,
    sellerSku,
    variation: '...',
    brand: { code: 1, name: 'Brand' },
    category: { code: 2, name: 'Category' },
    images: [{ url: 'https://example.test/image.jpg', primary: true }],
    price: { currency: 'NGN', value: 10 },
    stock: 1,
    attributes: [],
  };
}

describe('packJumiaProductFamilies', () => {
  it('orders complete families deterministically and rejects an oversized family', () => {
    const products = [
      {
        familyKey: 'b',
        businessClientCode: 'NG',
        categoryCode: 2,
        attributeSetId: 'set',
        record: record('B'),
      },
      {
        familyKey: 'a',
        businessClientCode: 'NG',
        categoryCode: 2,
        attributeSetId: 'set',
        record: record('A'),
      },
      {
        familyKey: 'a',
        businessClientCode: 'NG',
        categoryCode: 2,
        attributeSetId: 'set',
        record: record('A-2'),
      },
    ];

    expect(packJumiaProductFamilies(products, 1)).toMatchObject({
      success: false,
      errors: [{ code: 'family_exceeds_feed_limit', familyKey: 'a' }],
    });
    expect(packJumiaProductFamilies(products, 3)).toMatchObject({
      success: true,
      feeds: [
        {
          records: [
            { sellerSku: 'A' },
            { sellerSku: 'A-2' },
            { sellerSku: 'B' },
          ],
        },
      ],
    });
  });

  it('rejects duplicate seller SKUs and families crossing destination groups', () => {
    const item = {
      familyKey: 'family',
      businessClientCode: 'NG',
      categoryCode: 2,
      attributeSetId: 'set',
      record: record('DUP'),
    };
    expect(
      packJumiaProductFamilies([item, { ...item, familyKey: 'other' }])
    ).toMatchObject({
      success: false,
      errors: [{ code: 'duplicate_seller_sku', sellerSku: 'DUP' }],
    });
    expect(
      packJumiaProductFamilies([
        item,
        { ...item, categoryCode: 3, record: record('OTHER') },
      ])
    ).toMatchObject({
      success: false,
      errors: [{ code: 'family_group_mismatch', familyKey: 'family' }],
    });
  });
});
