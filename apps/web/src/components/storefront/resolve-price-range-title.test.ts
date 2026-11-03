import { describe, expect, it } from 'vitest';
import { resolvePriceRangeTitle } from './resolve-price-range-title';

describe('resolvePriceRangeTitle', () => {
  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

  it('uses the curated price band label when product falls within a curated band', () => {
    const title = resolvePriceRangeTitle({
      categorySlug: 'smartphones',
      currencyCode: 'NGN',
      rawPrice: 450_000,
      minPrice: 380_000,
      maxPrice: 520_000,
      productCategory: 'Smartphones',
      formatCurrency,
    });
    expect(title).toBe('Best Smartphones Under ₦500,000');
  });

  it('formats "Under {max}" when minPrice is below 10,000 and no curated band exists', () => {
    const title = resolvePriceRangeTitle({
      categorySlug: 'cameras',
      currencyCode: 'NGN',
      rawPrice: 50_000,
      minPrice: 5_000,
      maxPrice: 60_000,
      productCategory: 'Cameras',
      formatCurrency,
    });
    expect(title).toBe('Cameras Under ₦60,000');
  });

  it('formats range when minPrice >= 10,000 and no curated band exists', () => {
    const title = resolvePriceRangeTitle({
      categorySlug: 'cameras',
      currencyCode: 'NGN',
      rawPrice: 150_000,
      minPrice: 120_000,
      maxPrice: 180_000,
      productCategory: 'Cameras',
      formatCurrency,
    });
    expect(title).toBe('Cameras ₦120,000 - ₦180,000');
  });

  it('falls back to formatted range for NGN-gated categories when currency is non-NGN', () => {
    const title = resolvePriceRangeTitle({
      categorySlug: 'gaming-laptops',
      currencyCode: 'USD',
      rawPrice: 900_000,
      minPrice: 700_000,
      maxPrice: 1_100_000,
      productCategory: 'Gaming Laptops',
      formatCurrency: (amount) => `$${amount}`,
    });
    expect(title).toBe('Gaming Laptops $700000 - $1100000');
  });
});
