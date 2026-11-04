import { describe, expect, it } from 'vitest';
import type { CategoryHubProduct } from './category-hub-types';
import { isCategoryHubProductAvailable } from './is-category-hub-product-available';

function makeProduct(
  slug: string,
  price: number,
  stock: number | null = 5,
  manageStock: boolean | null | undefined = true,
  hasConditionOffers = false
): CategoryHubProduct {
  return {
    id: slug,
    slug,
    name: `Device ${slug}`,
    brand: 'BrandX',
    condition: 'New',
    price,
    stock,
    manage_stock: manageStock,
    has_condition_offers: hasConditionOffers,
    category_slug: 'test-category',
  };
}

describe('isCategoryHubProductAvailable', () => {
  it('rejects zero, negative, or non-finite prices', () => {
    expect(isCategoryHubProductAvailable(makeProduct('zero', 0))).toBe(false);
    expect(isCategoryHubProductAvailable(makeProduct('neg', -100))).toBe(false);
    expect(isCategoryHubProductAvailable(makeProduct('nan', Number.NaN))).toBe(
      false
    );
  });

  it('accepts valid numeric string prices', () => {
    expect(
      isCategoryHubProductAvailable(
        makeProduct('str-price', '300000' as unknown as number)
      )
    ).toBe(true);
    expect(
      isCategoryHubProductAvailable(
        makeProduct('comma-price', '1,500' as unknown as number)
      )
    ).toBe(true);
  });

  it('treats products with unmanaged stock as available regardless of stock count', () => {
    expect(
      isCategoryHubProductAvailable(
        makeProduct('unmanaged-false', 100, 0, false)
      )
    ).toBe(true);
    expect(
      isCategoryHubProductAvailable(makeProduct('unmanaged-null', 100, 0, null))
    ).toBe(true);
    const unmanagedUndef = makeProduct('unmanaged-undef', 100, 0);
    delete (unmanagedUndef as { manage_stock?: unknown }).manage_stock;
    expect(isCategoryHubProductAvailable(unmanagedUndef)).toBe(true);
  });

  it('treats managed stock products with stock > 0 as available', () => {
    expect(
      isCategoryHubProductAvailable(
        makeProduct('managed-in-stock', 100, 3, true)
      )
    ).toBe(true);
  });

  it('rejects managed stock products with 0 or null stock unless condition offers exist', () => {
    expect(
      isCategoryHubProductAvailable(
        makeProduct('managed-oos', 100, 0, true, false)
      )
    ).toBe(false);
    expect(
      isCategoryHubProductAvailable(
        makeProduct('managed-null-stock', 100, null, true, false)
      )
    ).toBe(false);
    expect(
      isCategoryHubProductAvailable(
        makeProduct('managed-oos-condition', 100, 0, true, true)
      )
    ).toBe(true);
    expect(
      isCategoryHubProductAvailable(
        makeProduct('managed-null-condition', 100, null, true, true)
      )
    ).toBe(true);
  });
});
