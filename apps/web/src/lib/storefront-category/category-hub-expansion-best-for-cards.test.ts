import { describe, expect, it } from 'vitest';
import { buildExpansionBestForCards } from './category-hub-expansion-best-for-cards';
import type { CategoryHubProduct } from './category-hub-types';

function makeProduct(
  slug: string,
  price: number,
  categorySlug: string,
  specs: Record<string, unknown> = {},
  stock = 5,
  manageStock = true
): CategoryHubProduct {
  return {
    id: slug,
    slug,
    name: `Product ${slug}`,
    brand: 'TestBrand',
    condition: 'New',
    price,
    stock,
    manage_stock: manageStock,
    category_slug: categorySlug,
    product_key_specs: specs,
  };
}

describe('buildExpansionBestForCards', () => {
  it('returns empty array for unknown expansion category', () => {
    expect(
      buildExpansionBestForCards({
        categorySlug: 'unknown',
        storeUrl: 'https://ogabassey.com',
        availableProducts: [makeProduct('p1', 100, 'unknown')],
      })
    ).toEqual([]);
  });

  describe('gaming-laptops', () => {
    it('builds highMemory, under2m, and largeScreen cards', () => {
      const products: CategoryHubProduct[] = [
        makeProduct('legion', 2_500_000, 'gaming-laptops', { ram_gb: 32 }),
        makeProduct('tuf-budget', 1_500_000, 'gaming-laptops', { ram_gb: 16 }),
        makeProduct('blade-big', 3_000_000, 'gaming-laptops', {
          screen_size_inches: 17,
        }),
      ];

      const cards = buildExpansionBestForCards({
        categorySlug: 'gaming-laptops',
        storeUrl: 'https://ogabassey.com',
        availableProducts: products,
        merchantCurrency: 'NGN',
      });

      expect(cards.length).toBe(3);
      expect(cards.map((c) => c.href)).toEqual([
        'https://ogabassey.com/gaming-laptops/legion',
        'https://ogabassey.com/gaming-laptops/tuf-budget',
        'https://ogabassey.com/gaming-laptops/blade-big',
      ]);
    });

    it('suppresses under2m card when currency is non-NGN', () => {
      const products: CategoryHubProduct[] = [
        makeProduct('tuf-budget', 1_500_000, 'gaming-laptops', { ram_gb: 8 }),
      ];

      const cards = buildExpansionBestForCards({
        categorySlug: 'gaming-laptops',
        storeUrl: 'https://ogabassey.com',
        availableProducts: products,
        merchantCurrency: 'USD',
      });

      expect(cards).toEqual([]);
    });
  });

  describe('tablets', () => {
    it('builds budget, battery, and largeScreen cards', () => {
      const products: CategoryHubProduct[] = [
        makeProduct('redmi-pad-budget', 200_000, 'tablets'),
        makeProduct('tab-battery', 400_000, 'tablets', { battery_mah: 8000 }),
        makeProduct('ipad-pro-large', 1_200_000, 'tablets', {
          screen_size_inches: 12.9,
        }),
      ];

      const cards = buildExpansionBestForCards({
        categorySlug: 'tablets',
        storeUrl: 'https://ogabassey.com',
        availableProducts: products,
        merchantCurrency: 'NGN',
      });

      expect(cards.length).toBe(3);
      expect(cards.map((c) => c.href)).toEqual([
        'https://ogabassey.com/tablets/redmi-pad-budget',
        'https://ogabassey.com/tablets/tab-battery',
        'https://ogabassey.com/tablets/ipad-pro-large',
      ]);
    });
  });

  describe('audio', () => {
    it('builds budget, midrange, and premium cards', () => {
      const products: CategoryHubProduct[] = [
        makeProduct('riversong-budget', 50_000, 'audio'),
        makeProduct('jbl-mid', 250_000, 'audio'),
        makeProduct('sony-premium', 650_000, 'audio'),
      ];

      const cards = buildExpansionBestForCards({
        categorySlug: 'audio',
        storeUrl: 'https://ogabassey.com',
        availableProducts: products,
        merchantCurrency: 'NGN',
      });

      expect(cards.length).toBe(3);
      expect(cards.map((c) => c.href)).toEqual([
        'https://ogabassey.com/audio/riversong-budget',
        'https://ogabassey.com/audio/jbl-mid',
        'https://ogabassey.com/audio/sony-premium',
      ]);
    });
  });

  describe('smartwatches', () => {
    it('builds budget, midrange, and premium cards', () => {
      const products: CategoryHubProduct[] = [
        makeProduct('budget-fit', 80_000, 'smartwatches'),
        makeProduct('galaxy-watch-mid', 250_000, 'smartwatches'),
        makeProduct('apple-ultra-premium', 750_000, 'smartwatches'),
      ];

      const cards = buildExpansionBestForCards({
        categorySlug: 'smartwatches',
        storeUrl: 'https://ogabassey.com',
        availableProducts: products,
        merchantCurrency: 'NGN',
      });

      expect(cards.length).toBe(3);
      expect(cards.map((c) => c.href)).toEqual([
        'https://ogabassey.com/smartwatches/budget-fit',
        'https://ogabassey.com/smartwatches/galaxy-watch-mid',
        'https://ogabassey.com/smartwatches/apple-ultra-premium',
      ]);
    });
  });

  describe('playstation-5', () => {
    it('builds under50k, midTier, and upperTier cards', () => {
      const products: CategoryHubProduct[] = [
        makeProduct('ps5-cheap-game', 40_000, 'playstation-5'),
        makeProduct('ps5-mid-game', 80_000, 'playstation-5'),
        makeProduct('ps5-console', 650_000, 'playstation-5'),
      ];

      const cards = buildExpansionBestForCards({
        categorySlug: 'playstation-5',
        storeUrl: 'https://ogabassey.com',
        availableProducts: products,
        merchantCurrency: 'NGN',
      });

      expect(cards.length).toBe(3);
      expect(cards.map((c) => c.href)).toEqual([
        'https://ogabassey.com/playstation-5/ps5-cheap-game',
        'https://ogabassey.com/playstation-5/ps5-mid-game',
        'https://ogabassey.com/playstation-5/ps5-console',
      ]);
    });
  });
});
