import { describe, expect, it } from 'vitest';
import {
  compareByPriceAsc,
  compareBySpecDescThenPriceAsc,
  getSpecNumber,
  isProductAvailable,
  pickRepresentativeProduct,
} from './category-hub-best-for-helpers';
import type { CategoryHubProduct } from './category-hub-types';

function makeProduct(
  slug: string,
  price: number,
  specs: Record<string, unknown> = {},
  stock: number | null = 5,
  manageStock: boolean | null | undefined = true,
  hasConditionOffers = false,
  name = `Device ${slug}`
): CategoryHubProduct {
  return {
    id: slug,
    slug,
    name,
    brand: 'BrandX',
    condition: 'New',
    price,
    stock,
    manage_stock: manageStock,
    has_condition_offers: hasConditionOffers,
    category_slug: 'test-category',
    product_key_specs: specs,
  };
}

describe('getSpecNumber', () => {
  it('extracts finite numbers correctly', () => {
    const product = makeProduct('p1', 100, { ram_gb: 16, weight: 1.5 });
    expect(getSpecNumber(product, 'ram_gb')).toBe(16);
    expect(getSpecNumber(product, 'weight')).toBe(1.5);
  });

  it('returns null for missing, non-numeric, or non-finite values', () => {
    const product = makeProduct('p2', 100, {
      text: '16GB',
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
      empty: null,
    });
    expect(getSpecNumber(product, 'text')).toBeNull();
    expect(getSpecNumber(product, 'nan')).toBeNull();
    expect(getSpecNumber(product, 'inf')).toBeNull();
    expect(getSpecNumber(product, 'empty')).toBeNull();
    expect(getSpecNumber(product, 'nonexistent')).toBeNull();
  });
});

describe('isProductAvailable', () => {
  it('rejects zero, negative, or non-finite prices', () => {
    expect(isProductAvailable(makeProduct('zero', 0))).toBe(false);
    expect(isProductAvailable(makeProduct('neg', -100))).toBe(false);
    expect(isProductAvailable(makeProduct('nan', Number.NaN))).toBe(false);
  });

  it('treats products with unmanaged stock as available regardless of stock count', () => {
    expect(
      isProductAvailable(makeProduct('unmanaged-false', 100, {}, 0, false))
    ).toBe(true);
    expect(
      isProductAvailable(makeProduct('unmanaged-null', 100, {}, 0, null))
    ).toBe(true);
    const unmanagedUndef = makeProduct('unmanaged-undef', 100, {}, 0);
    delete (unmanagedUndef as { manage_stock?: unknown }).manage_stock;
    expect(isProductAvailable(unmanagedUndef)).toBe(true);
  });

  it('treats managed stock products with stock > 0 as available', () => {
    expect(
      isProductAvailable(makeProduct('managed-in-stock', 100, {}, 3, true))
    ).toBe(true);
    expect(
      isProductAvailable(makeProduct('managed-null-stock', 100, {}, null, true))
    ).toBe(true);
  });

  it('rejects managed stock products with 0 stock unless condition offers exist', () => {
    expect(
      isProductAvailable(makeProduct('managed-oos', 100, {}, 0, true, false))
    ).toBe(false);
    expect(
      isProductAvailable(
        makeProduct('managed-oos-condition', 100, {}, 0, true, true)
      )
    ).toBe(true);
  });
});

describe('pickRepresentativeProduct', () => {
  it('returns null for empty products array', () => {
    expect(pickRepresentativeProduct([], compareByPriceAsc)).toBeNull();
  });

  it('returns the top element after sorting with comparator', () => {
    const p1 = makeProduct('p1', 500);
    const p2 = makeProduct('p2', 200);
    const p3 = makeProduct('p3', 300);
    expect(
      pickRepresentativeProduct([p1, p2, p3], compareByPriceAsc)?.slug
    ).toBe('p2');
  });
});

describe('compareByPriceAsc', () => {
  it('sorts primarily by price ascending', () => {
    const p1 = makeProduct('p1', 300);
    const p2 = makeProduct('p2', 100);
    expect(compareByPriceAsc(p1, p2)).toBeGreaterThan(0);
    expect(compareByPriceAsc(p2, p1)).toBeLessThan(0);
  });

  it('breaks ties by name then slug', () => {
    const a = makeProduct('slug-b', 100, {}, 5, true, false, 'Alpha');
    const b = makeProduct('slug-a', 100, {}, 5, true, false, 'Beta');
    expect(compareByPriceAsc(a, b)).toBeLessThan(0);

    const sameName1 = makeProduct('slug-a', 100, {}, 5, true, false, 'Same');
    const sameName2 = makeProduct('slug-b', 100, {}, 5, true, false, 'Same');
    expect(compareByPriceAsc(sameName1, sameName2)).toBeLessThan(0);
  });
});

describe('compareBySpecDescThenPriceAsc', () => {
  const comparator = compareBySpecDescThenPriceAsc('ram_gb');

  it('sorts primarily by spec descending', () => {
    const highRam = makeProduct('high', 500, { ram_gb: 32 });
    const lowRam = makeProduct('low', 200, { ram_gb: 16 });
    expect(comparator(highRam, lowRam)).toBeLessThan(0);
  });

  it('breaks spec ties by price ascending, then name, then slug', () => {
    const cheaper = makeProduct(
      'cheap',
      300,
      { ram_gb: 16 },
      5,
      true,
      false,
      'Phone'
    );
    const pricier = makeProduct(
      'pricy',
      600,
      { ram_gb: 16 },
      5,
      true,
      false,
      'Phone'
    );
    expect(comparator(cheaper, pricier)).toBeLessThan(0);

    const tieA = makeProduct(
      'slug-b',
      300,
      { ram_gb: 16 },
      5,
      true,
      false,
      'Alpha'
    );
    const tieB = makeProduct(
      'slug-a',
      300,
      { ram_gb: 16 },
      5,
      true,
      false,
      'Beta'
    );
    expect(comparator(tieA, tieB)).toBeLessThan(0);
  });
});
