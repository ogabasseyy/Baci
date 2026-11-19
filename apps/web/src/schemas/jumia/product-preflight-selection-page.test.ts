import { describe, expect, it } from 'vitest';
import { jumiaProductPreflightSelectionPageSchema } from './product-preflight-selection-page';

const selectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const categoryId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const productId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function page() {
  return {
    selectionId,
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
        product: { id: productId },
      },
    ],
  };
}

describe('jumiaProductPreflightSelectionPageSchema', () => {
  it('accepts a bounded page envelope with the same-snapshot source version', () => {
    expect(
      jumiaProductPreflightSelectionPageSchema.safeParse(page()).success
    ).toBe(true);
  });

  it.each([
    ['non-positive page', { page: 0 }],
    ['zero limit', { limit: 0 }],
    ['fractional total', { total: 0.5 }],
    ['invalid selection id', { selectionId: 'not-a-uuid' }],
    [
      'missing captured source version',
      {
        products: [{ ...page().products[0], capturedSourceVersion: undefined }],
      },
    ],
  ])('rejects %s', (_label, override) => {
    expect(
      jumiaProductPreflightSelectionPageSchema.safeParse({
        ...page(),
        ...override,
      }).success
    ).toBe(false);
  });
});
