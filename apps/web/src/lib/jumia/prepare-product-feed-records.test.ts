import { describe, expect, it } from 'vitest';
import type { JumiaPreparedContent } from './listing-content';
import { buildJumiaProductFamilyRecords } from './prepare-product-feed-records';
import type { JumiaCanonicalPreflightInput } from './prepare-product-feed-types';

const productId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const imageId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const input = {
  merchantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  selectionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  sourceCategoryId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  sourceVersion: 'f'.repeat(64),
  source: {
    contractVersion: 1,
    product: {
      id: productId,
      merchantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      status: 'active',
      hasVariants: false,
      variantModel: null,
      updatedAt: '2026-10-25T00:00:00Z',
      name: 'Nintendo Switch Console',
      description: 'Portable console',
      sku: 'SWITCH-1',
      exportImages: [],
      price: 100,
      stock: 2,
      stockQuantity: 2,
      manageStock: true,
      inventoryTrackingPolicy: 'off',
      inventoryAnchorVariantId: null,
      condition: 'new',
      weightValue: 1,
      weightUnit: 'kg',
      categoryId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    },
    categoryMemberships: [
      {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        name: 'Gaming',
        isActive: true,
      },
    ],
    variants: [],
    images: [],
  },
  destination: {
    shopId: '11111111-1111-4111-8111-111111111111',
    businessClientCode: 'NG-RETAIL',
    countryCode: 'NG',
    localCurrency: 'NGN',
  },
  mapping: {
    category: {
      code: 1,
      name: 'Gaming',
      attributeSetId: '22222222-2222-4222-8222-222222222222',
      activeLeaf: true,
      availableForDestination: true,
    },
    brand: { code: 1, name: 'Nintendo', availableForDestination: true },
    attributes: [],
    values: {},
    categoryConfirmed: true,
    bullets: ['One', 'Two', 'Three', 'Four'],
  },
  evidence: {
    providerClassification: 'non-3c',
    globalPrice: { currency: 'USD', value: 100 },
    images: {},
  },
} satisfies JumiaCanonicalPreflightInput;

const content: JumiaPreparedContent = {
  name: { value: 'Nintendo Switch Console' },
  description: { value: 'Portable console' },
  shortDescriptionHtml: '<ul><li>Portable</li></ul>',
  productWeightKg: 1,
};

describe('buildJumiaProductFamilyRecords', () => {
  it('assembles one canonical non-variant record without dropping local stock or price', () => {
    const errors: string[] = [];
    const records = buildJumiaProductFamilyRecords(
      input,
      {
        content,
        price: { currency: 'USD', value: 100 },
        orderedVariants: [],
        variationAttribute: undefined,
        variationValuesByVariant: new Map(),
        chosenImages: [
          {
            id: imageId,
            variantId: null,
            status: 'verified',
            verifiedUrl: 'https://images.example.test/switch.jpg',
            verifiedFormat: 'jpg',
            isPrimary: true,
            position: 0,
            verifiedAt: '2026-10-25T00:00:00Z',
            updatedAt: '2026-10-25T00:00:00Z',
          },
        ],
      },
      (field, code) => errors.push(`${field}:${code}`),
      () => errors.length > 0
    );

    expect(errors).toEqual([]);
    expect(records).toMatchObject([
      {
        sellerSku: 'SWITCH-1',
        parentSku: 'SWITCH-1',
        stock: 2,
        price: { currency: 'USD', value: 100 },
        businessClients: [
          {
            businessClientCode: 'NG-RETAIL',
            price: { currency: 'NGN', value: 100 },
          },
        ],
        images: [
          { url: 'https://images.example.test/switch.jpg', primary: true },
        ],
      },
    ]);
  });
});
