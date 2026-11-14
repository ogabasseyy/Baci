import { describe, expect, it } from 'vitest';
import { CATEGORY_HUB_CONSOLE_WEARABLE_DEFAULTS } from './category-hub-console-wearable-defaults';

describe('CATEGORY_HUB_CONSOLE_WEARABLE_DEFAULTS', () => {
  it('defines defaults for smartwatches and playstation-5', () => {
    expect(CATEGORY_HUB_CONSOLE_WEARABLE_DEFAULTS.smartwatches).toBeDefined();
    expect(
      CATEGORY_HUB_CONSOLE_WEARABLE_DEFAULTS['playstation-5']
    ).toBeDefined();
  });

  it('includes price bands and best-for definitions', () => {
    for (const defaults of Object.values(
      CATEGORY_HUB_CONSOLE_WEARABLE_DEFAULTS
    )) {
      expect(defaults.priceBands.length).toBeGreaterThan(0);
      expect(Object.keys(defaults.bestFor).length).toBeGreaterThan(0);
    }
  });
});
