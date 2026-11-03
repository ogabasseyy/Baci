import { describe, expect, it } from 'vitest';
import { CATEGORY_HUB_DEFAULTS } from '@/config/category-hub-defaults';
import {
  CURATED_PRICE_BANDS,
  getConfiguredPriceBands,
  getCuratedPriceBands,
  isPriceBandCurrencySupported,
  NGN_GATED_PRICE_BAND_CATEGORIES,
} from '@/lib/storefront-compare/price-band-taxonomy';

describe('price-band-taxonomy', () => {
  describe('configured price bands across all 5 new categories', () => {
    it('defines the exact 15 curated price bands with correct ceiling values', () => {
      expect(CURATED_PRICE_BANDS['gaming-laptops']).toEqual([
        {
          slug: 'under-1-5m',
          label: 'Best Gaming Laptops Under ₦1,500,000',
          ceiling: 1_500_000,
        },
        {
          slug: 'under-2-5m',
          label: 'Best Gaming Laptops Under ₦2,500,000',
          ceiling: 2_500_000,
        },
        {
          slug: 'under-4m',
          label: 'Best Gaming Laptops Under ₦4,000,000',
          ceiling: 4_000_000,
        },
      ]);

      expect(CURATED_PRICE_BANDS.tablets).toEqual([
        {
          slug: 'under-200k',
          label: 'Best Tablets Under ₦200,000',
          ceiling: 200_000,
        },
        {
          slug: 'under-500k',
          label: 'Best Tablets Under ₦500,000',
          ceiling: 500_000,
        },
        {
          slug: 'under-1m',
          label: 'Best Tablets Under ₦1,000,000',
          ceiling: 1_000_000,
        },
      ]);

      expect(CURATED_PRICE_BANDS.audio).toEqual([
        {
          slug: 'under-50k',
          label: 'Best Audio & Speakers Under ₦50,000',
          ceiling: 50_000,
        },
        {
          slug: 'under-150k',
          label: 'Best Audio & Speakers Under ₦150,000',
          ceiling: 150_000,
        },
        {
          slug: 'under-500k',
          label: 'Best Audio & Speakers Under ₦500,000',
          ceiling: 500_000,
        },
      ]);

      expect(CURATED_PRICE_BANDS.smartwatches).toEqual([
        {
          slug: 'under-100k',
          label: 'Best Smartwatches Under ₦100,000',
          ceiling: 100_000,
        },
        {
          slug: 'under-300k',
          label: 'Best Smartwatches Under ₦300,000',
          ceiling: 300_000,
        },
        {
          slug: 'under-600k',
          label: 'Best Smartwatches Under ₦600,000',
          ceiling: 600_000,
        },
      ]);

      expect(CURATED_PRICE_BANDS['playstation-5']).toEqual([
        {
          slug: 'under-50k',
          label: 'Best PlayStation 5 Picks Under ₦50,000',
          ceiling: 50_000,
        },
        {
          slug: 'under-100k',
          label: 'Best PlayStation 5 Picks Under ₦100,000',
          ceiling: 100_000,
        },
        {
          slug: 'under-1m',
          label: 'Best PlayStation 5 Picks Under ₦1,000,000',
          ceiling: 1_000_000,
        },
      ]);
    });

    it('matches exact slug-set equality with CATEGORY_HUB_DEFAULTS for all 8 categories', () => {
      const allCategories = [
        'smartphones',
        'laptops',
        'smart-tvs',
        'gaming-laptops',
        'tablets',
        'audio',
        'smartwatches',
        'playstation-5',
      ] as const;

      for (const category of allCategories) {
        const taxonomyBands = getConfiguredPriceBands(category);
        const copyBands = CATEGORY_HUB_DEFAULTS[category].priceBands;

        const taxonomySlugs = taxonomyBands.map((band) => band.slug);
        const copySlugs = copyBands.map((copy) => copy.slug);

        expect(new Set(taxonomySlugs)).toEqual(new Set(copySlugs));
        expect(taxonomySlugs.length).toBe(copySlugs.length);
      }
    });
  });

  describe('isPriceBandCurrencySupported', () => {
    it('requires NGN for all 5 new gated categories', () => {
      for (const category of NGN_GATED_PRICE_BAND_CATEGORIES) {
        expect(isPriceBandCurrencySupported(category, 'NGN')).toBe(true);
        expect(isPriceBandCurrencySupported(category, 'ngn')).toBe(true);
        expect(isPriceBandCurrencySupported(category, ' NGN ')).toBe(true);

        expect(isPriceBandCurrencySupported(category, 'USD')).toBe(false);
        expect(isPriceBandCurrencySupported(category, 'GBP')).toBe(false);
        expect(isPriceBandCurrencySupported(category, 'EUR')).toBe(false);
        expect(isPriceBandCurrencySupported(category, null)).toBe(false);
        expect(isPriceBandCurrencySupported(category, undefined)).toBe(false);
        expect(isPriceBandCurrencySupported(category, '')).toBe(false);
      }
    });

    it('preserves backwards compatibility for legacy categories without gating', () => {
      const legacyCategories = ['smartphones', 'laptops', 'smart-tvs'];

      for (const category of legacyCategories) {
        expect(isPriceBandCurrencySupported(category, 'NGN')).toBe(true);
        expect(isPriceBandCurrencySupported(category, 'USD')).toBe(true);
        expect(isPriceBandCurrencySupported(category, null)).toBe(true);
        expect(isPriceBandCurrencySupported(category, undefined)).toBe(true);
      }
    });
  });

  describe('getCuratedPriceBands', () => {
    it('returns configured bands when currency is NGN', () => {
      expect(
        getCuratedPriceBands('gaming-laptops', { merchantCurrency: 'NGN' })
      ).toHaveLength(3);
      expect(
        getCuratedPriceBands('audio', { merchantCurrency: 'ngn' })
      ).toHaveLength(3);
      expect(getConfiguredPriceBands('gaming-laptops')).toHaveLength(3);
    });

    it('suppresses new-category bands when merchant currency is non-NGN or options omitted', () => {
      expect(getCuratedPriceBands('gaming-laptops')).toEqual([]);
      expect(getCuratedPriceBands('audio')).toEqual([]);
      expect(
        getCuratedPriceBands('gaming-laptops', { merchantCurrency: 'USD' })
      ).toEqual([]);
      expect(
        getCuratedPriceBands('tablets', { merchantCurrency: 'GBP' })
      ).toEqual([]);
      expect(getCuratedPriceBands('audio', { merchantCurrency: null })).toEqual(
        []
      );
      expect(
        getCuratedPriceBands('smartwatches', { merchantCurrency: undefined })
      ).toEqual([]);
      expect(
        getCuratedPriceBands('playstation-5', { merchantCurrency: 'EUR' })
      ).toEqual([]);
    });

    it('allows legacy categories even when merchant currency is non-NGN', () => {
      expect(
        getCuratedPriceBands('smartphones', { merchantCurrency: 'USD' })
      ).toHaveLength(2);
      expect(
        getCuratedPriceBands('laptops', { merchantCurrency: 'EUR' })
      ).toHaveLength(1);
      expect(
        getCuratedPriceBands('smart-tvs', { merchantCurrency: null })
      ).toHaveLength(1);
    });

    it('returns empty array for unknown categories', () => {
      expect(getCuratedPriceBands('unknown-category')).toEqual([]);
    });
  });
});
