import { describe, expect, it } from 'vitest';
import { checkJumiaPreflightContent } from './prepare-product-feed-content-checks';
import type { JumiaCanonicalPreflightInput } from './prepare-product-feed-types';

const input = {
  merchantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  selectionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  sourceCategoryId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  sourceVersion: 'd'.repeat(64),
  source: {
    contractVersion: 1,
    product: {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      merchantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'active',
      hasVariants: false,
      variantModel: null,
      updatedAt: '2026-10-25T00:00:00Z',
      name: 'A valid product title',
      description: 'Description text',
      sku: 'SKU-1',
      exportImages: [],
      price: 20,
      stock: 1,
      stockQuantity: 1,
      manageStock: true,
      inventoryTrackingPolicy: 'off',
      inventoryAnchorVariantId: null,
      condition: 'new',
      weightValue: 1,
      weightUnit: 'kg',
      categoryId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    },
    categoryMemberships: [
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        name: 'Gaming',
        isActive: true,
      },
    ],
    variants: [],
    images: [],
  },
  destination: {
    shopId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    businessClientCode: 'NG-RETAIL',
    countryCode: 'NG',
    localCurrency: 'NGN',
  },
  mapping: {
    category: {
      code: 1,
      name: 'Gaming',
      attributeSetId: '11111111-1111-4111-8111-111111111111',
      activeLeaf: true,
      availableForDestination: true,
    },
    brand: { code: 2, name: 'Brand', availableForDestination: true },
    attributes: [],
    values: {},
    categoryConfirmed: true,
    bullets: ['One', 'Two', 'Three', 'Four'],
  },
  evidence: {
    providerClassification: 'unknown',
    globalPrice: { currency: 'USD', value: 20 },
    images: {},
  },
} satisfies JumiaCanonicalPreflightInput;

describe('checkJumiaPreflightContent', () => {
  it('keeps unknown provider classification as an explicit boundary', () => {
    const errors: { field: string; code: string }[] = [];
    const result = checkJumiaPreflightContent(input, (field, code) => {
      errors.push({ field, code });
    });

    expect(result.contentResult).toMatchObject({
      success: true,
      classificationBoundary: 'provider-classification-required',
    });
    expect(errors).toContainEqual({
      field: 'evidence.providerClassification',
      code: 'classification_unproven',
    });
    expect(errors).not.toContainEqual(
      expect.objectContaining({ code: 'global_price_unproven' })
    );
  });
});
