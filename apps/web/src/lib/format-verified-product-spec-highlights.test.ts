import { describe, expect, it } from 'vitest';
import { formatVerifiedProductSpecHighlights } from './format-verified-product-spec-highlights';

describe('formatVerifiedProductSpecHighlights', () => {
  it('formats positive numbers and numeric strings in default order', () => {
    const highlights = formatVerifiedProductSpecHighlights({
      specs: {
        ram_gb: 8,
        storage_gb: '256',
        battery_mah: 5000,
        main_camera_mp: '50',
        screen_size_inches: 6.7,
      },
      category: 'Smartphones',
    });
    expect(highlights).toEqual(['8GB RAM', '256GB storage']);
  });

  it('ignores zero, negative values, and non-numeric strings', () => {
    const highlights = formatVerifiedProductSpecHighlights({
      specs: {
        ram_gb: 0,
        storage_gb: -256,
        battery_mah: 'unspecified',
        main_camera_mp: 48,
        screen_size_inches: '6.1',
      },
      category: 'Smartphones',
    });
    expect(highlights).toEqual(['48MP camera', '6.1" display']);
  });

  it('respects custom maxHighlights and custom key subsets', () => {
    const specs = {
      ram_gb: 12,
      storage_gb: 512,
      battery_mah: 4500,
      main_camera_mp: 108,
    };
    const threeHighlights = formatVerifiedProductSpecHighlights({
      specs,
      category: 'Smartphones',
      maxHighlights: 3,
    });
    expect(threeHighlights).toEqual([
      '12GB RAM',
      '512GB storage',
      '4500mAh battery',
    ]);

    const customKeys = formatVerifiedProductSpecHighlights({
      specs,
      category: 'Smartphones',
      keys: ['battery_mah', 'ram_gb'],
    });
    expect(customKeys).toEqual(['4500mAh battery', '12GB RAM']);
  });

  it('returns empty array when specs are missing or empty', () => {
    expect(formatVerifiedProductSpecHighlights({ specs: null })).toEqual([]);
    expect(formatVerifiedProductSpecHighlights({ specs: {} })).toEqual([]);
  });

  it('filters hardware highlights for accessory categories and retains them for smartphones', () => {
    const specs = { ram_gb: 8, storage_gb: 256 };

    expect(
      formatVerifiedProductSpecHighlights({
        specs,
        category: 'Phone Cases',
      })
    ).toEqual([]);

    expect(
      formatVerifiedProductSpecHighlights({
        specs,
        category: 'Accessories',
      })
    ).toEqual([]);

    expect(
      formatVerifiedProductSpecHighlights({
        specs,
        categorySlugs: ['phone-cases'],
      })
    ).toEqual([]);

    expect(
      formatVerifiedProductSpecHighlights({
        specs,
        category: 'Smartphones',
      })
    ).toEqual(['8GB RAM', '256GB storage']);

    expect(
      formatVerifiedProductSpecHighlights({
        specs,
        categorySlugs: ['smartphones'],
      })
    ).toEqual(['8GB RAM', '256GB storage']);
  });

  it('supports refresh_rate_hz formatting in default highlight order', () => {
    const highlights = formatVerifiedProductSpecHighlights({
      specs: {
        refresh_rate_hz: 120,
      },
      category: 'Monitors',
    });
    expect(highlights).toEqual(['120Hz refresh rate']);

    const stringHighlights = formatVerifiedProductSpecHighlights({
      specs: {
        refresh_rate_hz: '144',
      },
      category: 'Monitors',
    });
    expect(stringHighlights).toEqual(['144Hz refresh rate']);
  });

  it('filters refresh_rate_hz for accessory categories and retains it for supported device categories', () => {
    const specs = { refresh_rate_hz: 144 };

    expect(
      formatVerifiedProductSpecHighlights({
        specs,
        category: 'Phone Cases',
      })
    ).toEqual([]);

    expect(
      formatVerifiedProductSpecHighlights({
        specs,
        category: 'Accessories',
      })
    ).toEqual([]);

    expect(
      formatVerifiedProductSpecHighlights({
        specs,
        categorySlugs: ['phone-cases'],
      })
    ).toEqual([]);

    expect(
      formatVerifiedProductSpecHighlights({
        specs,
        category: 'Monitors',
      })
    ).toEqual(['144Hz refresh rate']);

    expect(
      formatVerifiedProductSpecHighlights({
        specs,
        categorySlugs: ['monitors'],
      })
    ).toEqual(['144Hz refresh rate']);

    expect(
      formatVerifiedProductSpecHighlights({
        specs,
        categorySlugs: ['smartphones'],
      })
    ).toEqual(['144Hz refresh rate']);
  });
});
