import { describe, expect, it } from 'vitest';
import { normalizeAnalyticsProduct } from './normalize-analytics-product';

describe('normalizeAnalyticsProduct', () => {
  it('keeps a numeric catalog price', () => {
    expect(
      normalizeAnalyticsProduct({ id: 'p1', name: 'Phone', price: 100 })
    ).toEqual({ id: 'p1', name: 'Phone', price: 100 });
  });

  it('uses rawPrice when the template price is a formatted string', () => {
    // Regression: ogabassey grids pass '₦5,985,000' as price, which
    // /api/events rejected with HTTP 400.
    const templateProduct = {
      id: 7,
      name: 'Legion',
      price: '₦5,985,000',
      rawPrice: 5_985_000,
      category: 'Laptops',
    } as never;

    expect(normalizeAnalyticsProduct(templateProduct)).toEqual({
      id: '7',
      name: 'Legion',
      price: 5_985_000,
      category: 'Laptops',
    });
  });

  it('returns null when no numeric price exists', () => {
    expect(
      normalizeAnalyticsProduct({ id: 'p1', name: 'X', price: 'N/A' } as never)
    ).toBeNull();
  });
});
