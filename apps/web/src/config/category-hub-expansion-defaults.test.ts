import { describe, expect, it } from 'vitest';
import { CATEGORY_HUB_EXPANSION_DEFAULTS } from './category-hub-expansion-defaults';

describe('CATEGORY_HUB_EXPANSION_DEFAULTS', () => {
  it('defines defaults for gaming-laptops, tablets, and audio', () => {
    expect(CATEGORY_HUB_EXPANSION_DEFAULTS['gaming-laptops']).toBeDefined();
    expect(CATEGORY_HUB_EXPANSION_DEFAULTS.tablets).toBeDefined();
    expect(CATEGORY_HUB_EXPANSION_DEFAULTS.audio).toBeDefined();
  });

  it('includes price bands for each expansion category', () => {
    for (const defaults of Object.values(CATEGORY_HUB_EXPANSION_DEFAULTS)) {
      expect(defaults.priceBands.length).toBeGreaterThan(0);
      for (const band of defaults.priceBands) {
        expect(band.slug).toMatch(/^under-/);
        expect(band.title).toBeTruthy();
      }
    }
  });
});
