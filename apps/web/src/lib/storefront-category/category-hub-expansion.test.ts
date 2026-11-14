import { describe, expect, it } from 'vitest';
import {
  CATEGORY_HUB_DEFAULTS,
  CATEGORY_HUB_PRIORITY_CATEGORIES,
} from '@/config/category-hub-defaults';
import { buildBestForCards } from '@/lib/storefront-category/category-hub-best-for-cards';
import { buildCategoryHubCards } from '@/lib/storefront-category/category-hub-cards';
import { buildPriceBandCards } from '@/lib/storefront-category/category-hub-price-band-cards';
import type { CategoryHubProduct } from '@/lib/storefront-category/category-hub-types';
import { validateCategoryHubPriceBandConfig } from '@/lib/storefront-category/validate-category-hub-price-band-config';

function makeProduct(
  slug: string,
  price: number,
  brand = 'BrandA',
  specs?: Record<string, unknown>,
  stock = 10,
  manageStock = false,
  conditionOffers = false
): CategoryHubProduct {
  return {
    slug,
    name: slug,
    price,
    brand,
    category_slug: 'gaming-laptops',
    manage_stock: manageStock,
    stock,
    has_condition_offers: conditionOffers,
    product_key_specs: specs,
  };
}

const makeLaptop = (s: string, p: number, b: string, r: number, sc: number) =>
  makeProduct(s, p, b, { ram_gb: r, screen_size_inches: sc });

const makeStock = (
  s: string,
  p: number,
  st: number,
  m: boolean,
  c = false,
  r = 32
) => makeProduct(s, p, 'ASUS', { ram_gb: r }, st, m, c);

describe('Category Hub Expansion (Phase 3A)', () => {
  describe('slug-keyed price band copy resolution and reorder regression', () => {
    it('validates price band config slug-set equality across all priority categories', () => {
      for (const cat of CATEGORY_HUB_PRIORITY_CATEGORIES) {
        expect(() => validateCategoryHubPriceBandConfig(cat)).not.toThrow();
      }
    });

    it('preserves title and URL pairing even when copy array order is shuffled', () => {
      const eligibleProducts = [
        'ASUS',
        'MSI',
        'Dell',
        'ASUS',
        'MSI',
        'Dell',
      ].map((brand, i) => makeProduct(`g${i}`, 1_000_000 + i * 50_000, brand));

      const cardsNormal = buildPriceBandCards({
        categorySlug: 'gaming-laptops',
        storeUrl: 'https://store.test',
        products: eligibleProducts,
        merchantCurrency: 'NGN',
      });
      expect(cardsNormal.length).toBeGreaterThan(0);
      expect(cardsNormal[0].href).toBe(
        'https://store.test/gaming-laptops/best-under/under-1-5m'
      );
      expect(cardsNormal[0].title).toBe('Best Gaming Laptops Under ₦1,500,000');

      const originalBands = CATEGORY_HUB_DEFAULTS['gaming-laptops'].priceBands;
      try {
        CATEGORY_HUB_DEFAULTS['gaming-laptops'].priceBands = [
          ...originalBands,
        ].reverse();

        const cardsShuffled = buildPriceBandCards({
          categorySlug: 'gaming-laptops',
          storeUrl: 'https://store.test',
          products: eligibleProducts,
          merchantCurrency: 'NGN',
        });

        expect(cardsShuffled[0].href).toBe(
          'https://store.test/gaming-laptops/best-under/under-1-5m'
        );
        expect(cardsShuffled[0].title).toBe(
          'Best Gaming Laptops Under ₦1,500,000'
        );
      } finally {
        CATEGORY_HUB_DEFAULTS['gaming-laptops'].priceBands = originalBands;
      }
    });
  });

  describe('currency gating across 5 new categories', () => {
    const gamingProducts: CategoryHubProduct[] = [
      makeLaptop('gl-1', 1_800_000, 'ASUS', 32, 16),
      makeLaptop('gl-2', 1_400_000, 'MSI', 16, 17.3),
      makeLaptop('gl-3', 2_500_000, 'Dell', 16, 16),
      makeLaptop('gl-4', 1_200_000, 'Lenovo', 16, 16),
      makeLaptop('gl-5', 1_100_000, 'Acer', 16, 16),
      makeLaptop('gl-6', 1_300_000, 'HP', 16, 16.1),
    ];

    it('gaming-laptops: gates price band cards and under2m best-for card on NGN', () => {
      const ngnCards = buildCategoryHubCards({
        categorySlug: 'gaming-laptops',
        storeUrl: 'https://store.test',
        products: gamingProducts,
        merchantCurrency: 'NGN',
      });
      expect(ngnCards.bestForCards.map((c) => c.title)).toEqual([
        'Best 16GB+ RAM Gaming Laptops',
        'Best Gaming Laptops Under ₦2,000,000',
        'Best 16-Inch+ Gaming Laptops',
      ]);
      expect(ngnCards.priceBandCards.length).toBeGreaterThan(0);

      const usdCards = buildCategoryHubCards({
        categorySlug: 'gaming-laptops',
        storeUrl: 'https://store.test',
        products: gamingProducts,
        merchantCurrency: 'USD',
      });
      expect(usdCards.bestForCards.map((c) => c.title)).toEqual([
        'Best 16GB+ RAM Gaming Laptops',
        'Best 16-Inch+ Gaming Laptops',
      ]);
      expect(usdCards.priceBandCards).toEqual([]);

      const noCurrCards = buildCategoryHubCards({
        categorySlug: 'gaming-laptops',
        storeUrl: 'https://store.test',
        products: gamingProducts,
        merchantCurrency: undefined,
      });
      expect(noCurrCards.bestForCards.map((c) => c.title)).toEqual([
        'Best 16GB+ RAM Gaming Laptops',
        'Best 16-Inch+ Gaming Laptops',
      ]);
      expect(noCurrCards.priceBandCards).toEqual([]);
    });

    it('tablets: gates budget card on NGN while battery and largeScreen remain on non-NGN', () => {
      const tabletProducts: CategoryHubProduct[] = [
        makeProduct('tab-1', 240_000, 'Apple', {
          battery_mah: 7500,
          screen_size_inches: 11,
        }),
      ];

      const ngn = buildBestForCards({
        categorySlug: 'tablets',
        storeUrl: 'https://store.test',
        products: tabletProducts,
        merchantCurrency: 'NGN',
      });
      expect(ngn.map((c) => c.title)).toEqual([
        'Best Budget Tablets',
        'Tablets with 7,000mAh+ Batteries',
        'Best Large-Screen Tablets',
      ]);

      const usd = buildBestForCards({
        categorySlug: 'tablets',
        storeUrl: 'https://store.test',
        products: tabletProducts,
        merchantCurrency: 'USD',
      });
      expect(usd.map((c) => c.title)).toEqual([
        'Tablets with 7,000mAh+ Batteries',
        'Best Large-Screen Tablets',
      ]);
    });

    it('audio, smartwatches, and playstation-5: all cards suppressed when non-NGN or undefined', () => {
      const audioProducts = [
        makeProduct('a1', 45_000, 'JBL'),
        makeProduct('a2', 200_000, 'JBL'),
        makeProduct('a3', 650_000, 'JBL'),
      ];

      expect(
        buildBestForCards({
          categorySlug: 'audio',
          storeUrl: 'https://store.test',
          products: audioProducts,
          merchantCurrency: 'NGN',
        })
      ).toHaveLength(3);

      expect(
        buildBestForCards({
          categorySlug: 'audio',
          storeUrl: 'https://store.test',
          products: audioProducts,
          merchantCurrency: 'USD',
        })
      ).toEqual([]);

      expect(
        buildBestForCards({
          categorySlug: 'audio',
          storeUrl: 'https://store.test',
          products: audioProducts,
          merchantCurrency: undefined,
        })
      ).toEqual([]);

      const ps5Products = [
        makeProduct('p1', 40_000, 'PlayStation'),
        makeProduct('p2', 90_000, 'PlayStation'),
        makeProduct('p3', 800_000, 'PlayStation'),
      ];

      expect(
        buildBestForCards({
          categorySlug: 'playstation-5',
          storeUrl: 'https://store.test',
          products: ps5Products,
          merchantCurrency: 'NGN',
        })
      ).toHaveLength(3);

      expect(
        buildBestForCards({
          categorySlug: 'playstation-5',
          storeUrl: 'https://store.test',
          products: ps5Products,
          merchantCurrency: 'GBP',
        })
      ).toEqual([]);
    });
  });

  describe('availability and positive price semantics in bestForCards', () => {
    it('excludes managed out-of-stock and zero/negative priced items', () => {
      const products: CategoryHubProduct[] = [
        makeStock('gl-oos', 1_500_000, 0, true, false, 64),
        makeProduct('gl-free', 0, 'ASUS', { ram_gb: 64 }),
        makeStock('gl-unmanaged', 1_800_000, 0, false, false, 32),
      ];

      const cards = buildBestForCards({
        categorySlug: 'gaming-laptops',
        storeUrl: 'https://store.test',
        products,
        merchantCurrency: 'NGN',
      });

      const highMemCard = cards.find((c) =>
        c.title.includes('16GB+ RAM Gaming Laptops')
      );
      expect(highMemCard).toBeDefined();
      expect(highMemCard?.href).toBe(
        'https://store.test/gaming-laptops/gl-unmanaged'
      );
    });

    it('includes zero-stock product when has_condition_offers is true', () => {
      const products: CategoryHubProduct[] = [
        makeStock('gl-preowned', 1_600_000, 0, true, true, 32),
      ];

      const cards = buildBestForCards({
        categorySlug: 'gaming-laptops',
        storeUrl: 'https://store.test',
        products,
        merchantCurrency: 'NGN',
      });

      expect(cards[0]?.href).toBe(
        'https://store.test/gaming-laptops/gl-preowned'
      );
    });
  });
});
