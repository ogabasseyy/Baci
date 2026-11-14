import { describe, expect, it, vi } from 'vitest';
import * as priceBandTaxonomy from '@/lib/storefront-compare/price-band-taxonomy';
import { resolvePriceRangeTitle } from './resolve-price-range-title';

describe('resolvePriceRangeTitle', () => {
  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

  it('uses the curated price band label when product falls within a curated band', () => {
    const title = resolvePriceRangeTitle({
      categorySlug: 'smartphones',
      currencyCode: 'NGN',
      rawPrice: 400_000,
      minPrice: 340_000,
      maxPrice: 460_000,
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

  it('preserves curated band label for legacy categories with non-NGN currency per backwards compatibility contract', () => {
    const title = resolvePriceRangeTitle({
      categorySlug: 'smartphones',
      currencyCode: 'USD',
      rawPrice: 400_000,
      minPrice: 340_000,
      maxPrice: 460_000,
      productCategory: 'Smartphones',
      formatCurrency: (amount) => `$${amount}`,
    });
    expect(title).toBe('Best Smartphones Under ₦500,000');
  });

  it('falls back to formatted range when maxPrice exceeds curated band ceiling', () => {
    vi.spyOn(priceBandTaxonomy, 'getCuratedPriceBands').mockReturnValueOnce([
      {
        slug: 'under-500k',
        label: 'Best Smartphones Under ₦500,000',
        ceiling: 500_000,
      },
    ]);
    const title = resolvePriceRangeTitle({
      categorySlug: 'smartphones',
      currencyCode: 'NGN',
      rawPrice: 490_000,
      minPrice: 416_500,
      maxPrice: 563_500,
      productCategory: 'Smartphones',
      formatCurrency,
    });
    expect(title).toBe('Smartphones ₦416,500 - ₦563,500');
  });

  it('falls back to formatted range when minPrice falls below curated band floor', () => {
    vi.spyOn(priceBandTaxonomy, 'getCuratedPriceBands').mockReturnValueOnce([
      {
        slug: '500k-to-1m',
        label: 'Best Smartphones ₦500,000 - ₦1,000,000',
        ceiling: 1_000_000,
        floor: 500_000,
      },
    ]);
    const title = resolvePriceRangeTitle({
      categorySlug: 'smartphones',
      currencyCode: 'NGN',
      rawPrice: 550_000,
      minPrice: 467_500,
      maxPrice: 632_500,
      productCategory: 'Smartphones',
      formatCurrency,
    });
    expect(title).toBe('Smartphones ₦467,500 - ₦632,500');
  });

  it('treats band floor as exclusive (rawPrice equal to floor does not match)', () => {
    vi.spyOn(priceBandTaxonomy, 'getCuratedPriceBands').mockReturnValueOnce([
      {
        slug: '500k-to-1m',
        label: 'Best Smartphones ₦500,000 - ₦1,000,000',
        ceiling: 1_000_000,
        floor: 500_000,
      },
    ]);
    const title = resolvePriceRangeTitle({
      categorySlug: 'smartphones',
      currencyCode: 'NGN',
      rawPrice: 500_000,
      minPrice: 400_000,
      maxPrice: 600_000,
      productCategory: 'Smartphones',
      formatCurrency,
    });
    expect(title).toBe('Smartphones ₦400,000 - ₦600,000');
  });
});
