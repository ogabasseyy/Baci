import { describe, expect, it } from 'vitest';
import { adminGenerateProductImagesQuerySchema } from './admin-generate-product-images';

describe('adminGenerateProductImagesQuerySchema', () => {
  it('accepts an optional UUID parent product', () => {
    expect(
      adminGenerateProductImagesQuerySchema.parse({
        parent_product_id: '11111111-1111-4111-8111-111111111111',
      })
    ).toEqual({
      parent_product_id: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('rejects an untrusted parent-product filter', () => {
    expect(
      adminGenerateProductImagesQuerySchema.safeParse({
        parent_product_id: 'parent-1',
      }).success
    ).toBe(false);
  });
});
