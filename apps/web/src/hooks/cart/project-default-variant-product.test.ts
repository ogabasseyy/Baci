import type { ResolvedProductVariantSelection } from '@baci/shared/lib/product-default-variant';
import { describe, expect, it } from 'vitest';
import type { Product, ProductVariant } from '@/lib/products';
import { projectDefaultVariantProduct } from './project-default-variant-product';

function createProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    name: 'Phone',
    description: '',
    status: 'active',
    price: 100,
    manage_stock: true,
    stock: 8,
    image: '',
    imageLarge: '',
    imageHint: '',
    brand: '',
    gtin: '',
    mpn: '',
    ...overrides,
  };
}

function createSelection(
  variantOverrides: Partial<ProductVariant> = {},
  includeStockQuantity = true,
  stockQuantity: number | null = 0,
  overrides: Partial<ResolvedProductVariantSelection<ProductVariant>> = {}
): ResolvedProductVariantSelection<ProductVariant> {
  return {
    variant: {
      id: 'variant-1',
      product_id: 'product-1',
      merchant_id: 'merchant-1',
      attributes: {},
      stock_quantity: includeStockQuantity
        ? (variantOverrides.stock_quantity ?? stockQuantity ?? 0)
        : (variantOverrides.stock_quantity ?? 0),
      ...variantOverrides,
    },
    attributes: {},
    price: 120,
    ...overrides,
  };
}

describe('projectDefaultVariantProduct', () => {
  it('keeps the parent stock and disables stock checks for unmanaged off variants', () => {
    const result = projectDefaultVariantProduct(
      createProduct({ manage_stock: false, stock: 0 }),
      createSelection({ inventory_tracking_policy: 'off' })
    );

    expect(result).toMatchObject({
      price: 120,
      manage_stock: false,
      stock: 0,
    });
  });

  it('uses a depleted scalar for managed off variants', () => {
    const result = projectDefaultVariantProduct(
      createProduct({ manage_stock: true, stock: 8 }),
      createSelection({ inventory_tracking_policy: 'off', stock_quantity: 0 })
    );

    expect(result.manage_stock).toBe(true);
    expect(result.stock).toBe(0);
  });

  it('prefers serialized exact units over the scalar quantity', () => {
    const result = projectDefaultVariantProduct(
      createProduct(),
      createSelection({
        effective_policy: 'serialized_strict',
        available_units: 2,
        stock_quantity: 0,
      })
    );

    expect(result.stock).toBe(2);
  });

  it('uses the variant scalar and falls back to parent stock when omitted', () => {
    expect(
      projectDefaultVariantProduct(
        createProduct({ stock: 8 }),
        createSelection({ stock_quantity: 3 }, false)
      ).stock
    ).toBe(3);
    expect(
      projectDefaultVariantProduct(
        createProduct({ stock: 8 }),
        createSelection({ stock_quantity: undefined }, false)
      ).stock
    ).toBe(8);
  });

  it('uses the selected comparison price when provided', () => {
    const result = projectDefaultVariantProduct(
      createProduct({ compare_at_price: 110 }),
      createSelection({}, true, 0, { compareAtPrice: 130 })
    );

    expect(result.compare_at_price).toBe(130);
  });
});
