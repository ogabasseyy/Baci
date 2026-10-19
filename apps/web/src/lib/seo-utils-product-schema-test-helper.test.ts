import { describe, expect, it } from 'vitest';
import { makeSeoProduct } from './seo-utils-product-schema-test-helper';

describe('makeSeoProduct', () => {
  it('builds a minimal active product fixture with stable defaults', () => {
    expect(makeSeoProduct()).toMatchObject({
      id: 'test-123',
      name: 'Test Product',
      status: 'active',
      price: 100,
      manage_stock: true,
      stock: 10,
      brand: 'TestBrand',
    });
  });

  it('merges schema and category overrides into the fixture', () => {
    expect(
      makeSeoProduct({
        category: 'Action Cameras',
        product_key_specs: { main_camera_mp: 24 },
      })
    ).toMatchObject({
      category: 'Action Cameras',
      product_key_specs: { main_camera_mp: 24 },
    });
  });
});
