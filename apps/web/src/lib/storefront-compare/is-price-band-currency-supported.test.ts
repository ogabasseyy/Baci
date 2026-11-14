import { describe, expect, it } from 'vitest';
import { isPriceBandCurrencySupported } from './is-price-band-currency-supported';

describe('isPriceBandCurrencySupported', () => {
  describe('NGN-gated expansion categories', () => {
    const gatedCategories = [
      'gaming-laptops',
      'tablets',
      'audio',
      'smartwatches',
      'playstation-5',
    ];

    it.each(
      gatedCategories
    )('permits %s when currency is NGN (case-insensitive, trimmed)', (category) => {
      expect(isPriceBandCurrencySupported(category, 'NGN')).toBe(true);
      expect(isPriceBandCurrencySupported(category, 'ngn')).toBe(true);
      expect(isPriceBandCurrencySupported(category, ' NGN ')).toBe(true);
    });

    it.each(
      gatedCategories
    )('suppresses %s for non-NGN currencies or absent currency', (category) => {
      expect(isPriceBandCurrencySupported(category, 'USD')).toBe(false);
      expect(isPriceBandCurrencySupported(category, 'GBP')).toBe(false);
      expect(isPriceBandCurrencySupported(category, 'EUR')).toBe(false);
      expect(isPriceBandCurrencySupported(category, null)).toBe(false);
      expect(isPriceBandCurrencySupported(category, undefined)).toBe(false);
      expect(isPriceBandCurrencySupported(category, '')).toBe(false);
    });
  });

  describe('unrestricted legacy categories', () => {
    const legacyCategories = ['smartphones', 'laptops', 'smart-tvs'];

    it.each(
      legacyCategories
    )('permits %s regardless of merchant currency for backwards compatibility', (category) => {
      expect(isPriceBandCurrencySupported(category, 'NGN')).toBe(true);
      expect(isPriceBandCurrencySupported(category, 'USD')).toBe(true);
      expect(isPriceBandCurrencySupported(category, null)).toBe(true);
      expect(isPriceBandCurrencySupported(category, undefined)).toBe(true);
    });
  });
});
