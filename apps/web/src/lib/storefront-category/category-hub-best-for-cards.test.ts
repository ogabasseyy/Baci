import { describe, expect, it } from 'vitest';
import { buildBestForCards } from './category-hub-best-for-cards';
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

describe('buildBestForCards legacy categories', () => {
  it('returns empty array when category has no defaults or products are empty', () => {
    expect(
      buildBestForCards({
        categorySlug: 'unknown-category',
        storeUrl: 'https://ogabassey.com',
        products: [makeProduct('p1', 100, 'unknown-category')],
      })
    ).toEqual([]);

    expect(
      buildBestForCards({
        categorySlug: 'smartphones',
        storeUrl: 'https://ogabassey.com',
        products: [],
      })
    ).toEqual([]);
  });

  it('filters out unavailable products before building cards', () => {
    const oos = makeProduct(
      'oos-phone',
      100,
      'smartphones',
      { battery_mah: 6000 },
      0,
      true
    );
    const cards = buildBestForCards({
      categorySlug: 'smartphones',
      storeUrl: 'https://ogabassey.com',
      products: [oos],
    });
    expect(cards).toEqual([]);
  });

  it('builds battery, camera, and value cards for smartphones', () => {
    const products: CategoryHubProduct[] = [
      makeProduct('big-battery', 300_000, 'smartphones', {
        battery_mah: 5000,
        main_camera_mp: 50,
      }),
      makeProduct('pro-camera', 600_000, 'smartphones', {
        battery_mah: 4000,
        main_camera_mp: 200,
      }),
      makeProduct('budget-pick', 120_000, 'smartphones', {
        battery_mah: 4500,
        main_camera_mp: 48,
      }),
    ];

    const cards = buildBestForCards({
      categorySlug: 'smartphones',
      storeUrl: 'https://ogabassey.com',
      products,
    });

    expect(cards.length).toBeGreaterThan(0);
    const titles = cards.map((card) => card.title);
    expect(titles).toContain('Best for Battery Life');
    expect(titles).toContain('Best for Photography');

    const batteryCard = cards.find((c) => c.title === 'Best for Battery Life');
    expect(batteryCard?.href).toBe(
      'https://ogabassey.com/smartphones/big-battery'
    );
  });

  it('builds work, student, and display cards for laptops', () => {
    const products: CategoryHubProduct[] = [
      makeProduct('work-laptop', 800_000, 'laptops', {
        ram_gb: 32,
        screen_size_inches: 14,
      }),
      makeProduct('student-laptop', 350_000, 'laptops', {
        ram_gb: 16,
        screen_size_inches: 13.3,
      }),
      makeProduct('large-display', 900_000, 'laptops', {
        ram_gb: 16,
        screen_size_inches: 16,
      }),
    ];

    const cards = buildBestForCards({
      categorySlug: 'laptops',
      storeUrl: 'https://ogabassey.com',
      products,
    });

    expect(cards.length).toBeGreaterThan(0);
    const titles = cards.map((card) => card.title);
    expect(titles).toContain('Best for Work and School');
  });

  it('builds screen size and 4K display cards for smart-tvs', () => {
    const products: CategoryHubProduct[] = [
      makeProduct('giant-tv', 700_000, 'smart-tvs', {
        screen_size_inches: 75,
        display_resolution: '4K',
      }),
      makeProduct('standard-4k', 400_000, 'smart-tvs', {
        screen_size_inches: 55,
        display_resolution: '4K',
      }),
    ];

    const cards = buildBestForCards({
      categorySlug: 'smart-tvs',
      storeUrl: 'https://ogabassey.com',
      products,
    });

    expect(cards.length).toBeGreaterThan(0);
    const titles = cards.map((card) => card.title);
    expect(titles).toContain('Best for Big-Screen Viewing');
  });
});

describe('buildBestForCards expansion category delegation', () => {
  it('delegates gaming-laptops to expansion best-for card builder', () => {
    const products: CategoryHubProduct[] = [
      makeProduct('rog-strix', 2_500_000, 'gaming-laptops', {
        ram_gb: 32,
        screen_size_inches: 17,
      }),
    ];

    const cards = buildBestForCards({
      categorySlug: 'gaming-laptops',
      storeUrl: 'https://ogabassey.com',
      products,
      merchantCurrency: 'NGN',
    });

    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0]?.href).toBe(
      'https://ogabassey.com/gaming-laptops/rog-strix'
    );
  });
});
