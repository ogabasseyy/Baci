import { describe, expect, it } from 'vitest';
import {
  CATEGORY_HUB_DEFAULTS,
  CATEGORY_HUB_PRIORITY_CATEGORIES,
} from './category-hub-defaults';

describe('CATEGORY_HUB_DEFAULTS', () => {
  it('covers all priority categories in order', () => {
    expect(CATEGORY_HUB_PRIORITY_CATEGORIES).toEqual([
      'smartphones',
      'laptops',
      'smart-tvs',
      'gaming-laptops',
      'tablets',
      'audio',
      'smartwatches',
      'playstation-5',
    ]);

    for (const category of CATEGORY_HUB_PRIORITY_CATEGORIES) {
      const defaults = CATEGORY_HUB_DEFAULTS[category];
      expect(defaults).toBeDefined();
      expect(defaults.intro.heading).toBeTruthy();
      expect(defaults.trustFeatures.length).toBeGreaterThan(0);
      expect(defaults.faqItems.length).toBeGreaterThan(0);
      expect(defaults.priceBands.length).toBeGreaterThan(0);
    }
  });

  it('provides structured price bands with required slug and title', () => {
    for (const category of CATEGORY_HUB_PRIORITY_CATEGORIES) {
      const defaults = CATEGORY_HUB_DEFAULTS[category];
      for (const band of defaults.priceBands) {
        expect(band.slug).toBeTruthy();
        expect(band.title).toBeTruthy();
        expect(band.description).toBeTruthy();
      }
    }
  });
});
