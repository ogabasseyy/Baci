import { describe, expect, it } from 'vitest';
import { checkJumiaPreflightSource } from './prepare-product-feed-source-checks';
import type { JumiaCanonicalPreflightInput } from './prepare-product-feed-types';

const productId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const imageId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const categoryId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const input = {
  merchantId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  selectionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  sourceCategoryId: categoryId,
  sourceVersion: 'f'.repeat(64),
  source: {
    contractVersion: 1,
    product: {
      id: productId,
      merchantId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      status: 'active',
      hasVariants: false,
      variantModel: null,
      updatedAt: '2026-10-25T00:00:00Z',
      name: 'Product Name 123',
      description: 'A short description.',
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
      categoryId,
    },
    categoryMemberships: [{ id: categoryId, name: 'Gaming', isActive: true }],
    variants: [],
    images: [
      {
        id: imageId,
        variantId: null,
        status: 'verified',
        verifiedUrl: 'https://images.example.test/item.jpg',
        verifiedFormat: 'jpg',
        isPrimary: true,
        position: 0,
        verifiedAt: '2026-10-25T00:00:00Z',
        updatedAt: '2026-10-25T00:00:00Z',
      },
    ],
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
    brand: { code: 1, name: 'Brand', availableForDestination: true },
    attributes: [],
    values: {},
    categoryConfirmed: true,
    bullets: ['One', 'Two', 'Three', 'Four'],
  },
  evidence: {
    providerClassification: 'non-3c',
    globalPrice: { currency: 'USD', value: 20 },
    images: {
      [imageId]: {
        publiclyReachable: true,
        byteSize: 1024,
        width: 1000,
        height: 1000,
        qualityAccepted: true,
      },
    },
  },
} satisfies JumiaCanonicalPreflightInput;

describe('checkJumiaPreflightSource', () => {
  it('keeps one verified image and finite single-product facts in the source context', () => {
    const errors: string[] = [];
    const result = checkJumiaPreflightSource(input, (field, code) => {
      errors.push(`${field}:${code}`);
    });

    expect(result.orderedVariants).toEqual([]);
    expect(result.chosenImages).toEqual(input.source.images);
    expect(result.variationValuesByVariant.size).toBe(0);
    expect(errors).toEqual([]);
  });

  it('reports missing image-quality evidence instead of trusting the image URL', () => {
    const errors: string[] = [];
    checkJumiaPreflightSource(
      { ...input, evidence: { ...input.evidence, images: {} } },
      (field, code) => errors.push(`${field}:${code}`)
    );

    expect(errors).toContain(
      `evidence.images.${imageId}:image_evidence_incomplete`
    );
  });
});
