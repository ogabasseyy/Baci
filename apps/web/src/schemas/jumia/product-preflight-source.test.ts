import { describe, expect, it } from 'vitest';
import { jumiaProductPreflightSelectionPageSchema } from './product-preflight-selection-page';
import { jumiaCanonicalProductProjectionSchema } from './product-preflight-source';

const productId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const merchantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const categoryId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function projection() {
  return {
    contractVersion: 1,
    product: {
      id: productId,
      merchantId,
      status: 'active',
      hasVariants: false,
      variantModel: null,
      updatedAt: '2026-10-25T00:00:00Z',
      name: 'Nintendo Switch',
      description: 'Console',
      sku: 'SWITCH-001',
      exportImages: null,
      price: 250000,
      stock: 2,
      stockQuantity: null,
      manageStock: true,
      inventoryTrackingPolicy: 'off',
      inventoryAnchorVariantId: null,
      condition: null,
      weightValue: 0.4,
      weightUnit: 'kg',
      categoryId,
    },
    categoryMemberships: [{ id: categoryId, name: 'Gaming', isActive: true }],
    variants: [],
    images: [],
  };
}

describe('Jumia preflight source schemas', () => {
  it('accepts the exact canonical projection contract and rejects unknown product fields', () => {
    expect(
      jumiaCanonicalProductProjectionSchema.safeParse(projection()).success
    ).toBe(true);
    expect(
      jumiaCanonicalProductProjectionSchema.safeParse({
        ...projection(),
        product: { ...projection().product, inventedPrice: 1 },
      }).success
    ).toBe(false);
  });

  it('requires the bounded same-snapshot selection-page envelope', () => {
    const page = {
      selectionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      sourceCategoryId: categoryId,
      total: 1,
      page: 1,
      limit: 1,
      totalPages: 1,
      products: [
        {
          id: productId,
          ordinal: 1,
          capturedSourceVersion: 'a'.repeat(64),
          currentSourceVersion: 'a'.repeat(64),
          available: true,
          unavailableReason: null,
          product: projection(),
        },
      ],
    };
    expect(
      jumiaProductPreflightSelectionPageSchema.safeParse(page).success
    ).toBe(true);
    expect(
      jumiaProductPreflightSelectionPageSchema.safeParse({
        ...page,
        page: 0,
      }).success
    ).toBe(false);
  });
});
