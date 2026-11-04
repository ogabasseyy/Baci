import { describe, expect, it } from 'vitest';
import type { CategoryHubProduct } from './category-hub-types';
import { getCategoryHubSpecNumber } from './get-category-hub-spec-number';

function makeProduct(specs: Record<string, unknown> = {}): CategoryHubProduct {
  return {
    id: 'test-product',
    slug: 'test-product',
    name: 'Test Device',
    brand: 'BrandX',
    condition: 'New',
    price: 100_000,
    stock: 5,
    manage_stock: true,
    has_condition_offers: false,
    category_slug: 'test-category',
    product_key_specs: specs,
  };
}

describe('getCategoryHubSpecNumber', () => {
  it('extracts finite numbers correctly', () => {
    const product = makeProduct({ ram_gb: 16, weight: 1.5 });
    expect(getCategoryHubSpecNumber(product, 'ram_gb')).toBe(16);
    expect(getCategoryHubSpecNumber(product, 'weight')).toBe(1.5);
  });

  it('returns null for missing, non-numeric, or non-finite values', () => {
    const product = makeProduct({
      text: '16GB',
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
      empty: null,
    });
    expect(getCategoryHubSpecNumber(product, 'text')).toBeNull();
    expect(getCategoryHubSpecNumber(product, 'nan')).toBeNull();
    expect(getCategoryHubSpecNumber(product, 'inf')).toBeNull();
    expect(getCategoryHubSpecNumber(product, 'empty')).toBeNull();
    expect(getCategoryHubSpecNumber(product, 'nonexistent')).toBeNull();
  });
});
