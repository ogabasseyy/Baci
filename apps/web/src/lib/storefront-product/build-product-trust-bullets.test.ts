import { describe, expect, it } from 'vitest';
import { buildProductTrustBullets } from './build-product-trust-bullets';
import type { BuildProductSemanticModelInput } from './product-semantic-types';

function makeInput(
  productOverrides: Partial<
    BuildProductSemanticModelInput['currentProduct']
  > = {},
  inputOverrides: Partial<BuildProductSemanticModelInput> = {}
): BuildProductSemanticModelInput {
  return {
    storeUrl: 'https://ogabassey.com',
    merchantBusinessName: 'Ogabassey',
    categorySlug: 'smartphones',
    categoryName: 'Smartphones',
    inventory: [],
    ...inputOverrides,
    currentProduct: {
      slug: 'iphone-16e',
      name: 'iPhone 16e',
      price: 450_000,
      brand: 'Apple',
      category_slug: 'smartphones',
      ...productOverrides,
    },
  };
}

describe('buildProductTrustBullets', () => {
  it('formats condition bullet to title case and includes curated price band', () => {
    const bullets = buildProductTrustBullets(
      makeInput({ condition: 'open_box' })
    );
    expect(bullets).toEqual([
      'Available in Open Box condition',
      'Listed in Best Smartphones Under ₦500,000',
    ]);
  });

  it('omits price-band bullet when category has no curated bands', () => {
    const bullets = buildProductTrustBullets(
      makeInput(
        { condition: 'brand_new' },
        { categorySlug: 'cameras', categoryName: 'Cameras' }
      )
    );
    expect(bullets).toEqual(['Available in Brand New condition']);
  });

  it('adds in-stock bullet when stock > 0 and omits stock claim when parent stock <= 0 (so option-backed products are not falsely marked out of stock)', () => {
    expect(buildProductTrustBullets(makeInput({ stock: 4 }))).toContain(
      'In stock for immediate dispatch'
    );

    expect(buildProductTrustBullets(makeInput({ stock: 0 }))).not.toContain(
      'Currently out of stock'
    );

    expect(
      buildProductTrustBullets(
        makeInput({ stock: 0, has_condition_offers: true })
      )
    ).not.toContain('Currently out of stock');

    expect(buildProductTrustBullets(makeInput({ stock: -1 }))).not.toContain(
      'Currently out of stock'
    );
  });

  it('emits in-stock bullet when manage_stock is false with null stock and omits when manage_stock is undefined with null stock', () => {
    expect(
      buildProductTrustBullets(makeInput({ manage_stock: false, stock: null }))
    ).toContain('In stock for immediate dispatch');

    expect(
      buildProductTrustBullets(
        makeInput({ manage_stock: undefined, stock: null })
      )
    ).not.toContain('In stock for immediate dispatch');
  });

  it('formats up to 3 verified positive key specs into bullet', () => {
    const bullets = buildProductTrustBullets(
      makeInput({
        product_key_specs: {
          ram_gb: 8,
          storage_gb: 256,
          battery_mah: 5000,
          main_camera_mp: 48,
        },
      })
    );
    expect(bullets).toContain(
      'Key specs: 8GB RAM, 256GB storage, 5000mAh battery'
    );
  });

  it('formats sparse positive key specs correctly', () => {
    const bullets = buildProductTrustBullets(
      makeInput({
        product_key_specs: {
          ram_gb: 12,
          main_camera_mp: 50,
        },
      })
    );
    expect(bullets).toContain('Key specs: 12GB RAM, 50MP camera');
  });

  it('omits stock and spec bullets when stock is null/undefined and specs are empty', () => {
    const bulletsNull = buildProductTrustBullets(
      makeInput({
        condition: 'refurbished',
        stock: null,
        product_key_specs: null,
      })
    );
    expect(bulletsNull).toEqual([
      'Available in Refurbished condition',
      'Listed in Best Smartphones Under ₦500,000',
    ]);

    const bulletsUndefined = buildProductTrustBullets(
      makeInput({
        condition: 'brand_new',
        stock: undefined,
        product_key_specs: {
          ram_gb: 0,
          battery_mah: -100,
          storage_gb: 'invalid',
        },
      })
    );
    expect(bulletsUndefined).toEqual([
      'Available in Brand New condition',
      'Listed in Best Smartphones Under ₦500,000',
    ]);
  });

  it('preserves factual parity with all four bullets in expected order', () => {
    const bullets = buildProductTrustBullets(
      makeInput({
        condition: 'new',
        stock: 10,
        product_key_specs: {
          ram_gb: 16,
          storage_gb: 512,
          battery_mah: 4500,
        },
      })
    );
    expect(bullets).toEqual([
      'Available in New condition',
      'Listed in Best Smartphones Under ₦500,000',
      'In stock for immediate dispatch',
      'Key specs: 16GB RAM, 512GB storage, 4500mAh battery',
    ]);
  });
});
