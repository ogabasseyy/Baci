import type { CategoryHubProduct } from '@/lib/storefront-category/category-hub-types';

export function makeProduct(
  overrides: Partial<CategoryHubProduct> = {}
): CategoryHubProduct {
  return {
    slug: 'alpha-phone',
    name: 'Alpha Phone',
    price: 420000,
    brand: 'Apple',
    condition: 'new',
    category_slug: 'smartphones',
    product_key_specs: {
      ram_gb: 8,
      storage_gb: 128,
      screen_size_inches: 6.1,
    },
    ...overrides,
  };
}

export function buildSmartphoneProducts(): CategoryHubProduct[] {
  return [
    makeProduct({
      slug: 'alpha-phone',
      name: 'Alpha Phone',
      brand: 'Apple',
      price: 420000,
      product_key_specs: {
        main_camera_mp: 50,
        battery_mah: 5000,
        ram_gb: 8,
        storage_gb: 128,
      },
    }),
    makeProduct({
      slug: 'beta-phone',
      name: 'Beta Phone',
      brand: 'Samsung',
      price: 460000,
      product_key_specs: {
        main_camera_mp: 64,
        battery_mah: 6000,
        ram_gb: 12,
        storage_gb: 256,
      },
    }),
    makeProduct({
      slug: 'apple-mini',
      name: 'Apple Mini',
      brand: 'Apple',
      price: 390000,
      product_key_specs: {
        main_camera_mp: 48,
        battery_mah: 4700,
        ram_gb: 8,
        storage_gb: 128,
      },
    }),
    makeProduct({
      slug: 'apple-pro',
      name: 'Apple Pro',
      brand: 'Apple',
      price: 490000,
      product_key_specs: {
        main_camera_mp: 108,
        battery_mah: 6000,
        ram_gb: 12,
        storage_gb: 256,
      },
    }),
    makeProduct({
      slug: 'samsung-a',
      name: 'Samsung A',
      brand: 'Samsung',
      price: 350000,
      product_key_specs: {
        main_camera_mp: 48,
        battery_mah: 5500,
        ram_gb: 12,
        storage_gb: 256,
      },
    }),
    makeProduct({
      slug: 'samsung-b',
      name: 'Samsung B',
      brand: 'Samsung',
      price: 480000,
      product_key_specs: {
        main_camera_mp: 50,
        battery_mah: 5500,
        ram_gb: 12,
        storage_gb: 256,
      },
    }),
    makeProduct({
      slug: 'tecno-c',
      name: 'Tecno C',
      brand: 'Tecno',
      price: 470000,
      product_key_specs: {
        main_camera_mp: 32,
        battery_mah: 5000,
        ram_gb: 8,
        storage_gb: 128,
      },
    }),
  ];
}

export function buildLaptopProducts(): CategoryHubProduct[] {
  return [
    makeProduct({
      category_slug: 'laptops',
      slug: 'alpha-book',
      name: 'Alpha Book',
      brand: 'Dell',
      price: 820000,
      product_key_specs: {
        ram_gb: 8,
        storage_gb: 256,
      },
    }),
    makeProduct({
      category_slug: 'laptops',
      slug: 'beta-book',
      name: 'Beta Book',
      brand: 'Lenovo',
      price: 920000,
      product_key_specs: {
        ram_gb: 16,
        storage_gb: 512,
      },
    }),
    makeProduct({
      category_slug: 'laptops',
      slug: 'gamma-book',
      name: 'Gamma Book',
      brand: 'Dell',
      price: 780000,
      product_key_specs: {
        ram_gb: 8,
        storage_gb: 512,
      },
    }),
    makeProduct({
      category_slug: 'laptops',
      slug: 'delta-book',
      name: 'Delta Book',
      brand: 'HP',
      price: 990000,
      product_key_specs: {
        ram_gb: 32,
        storage_gb: 1024,
      },
    }),
    makeProduct({
      category_slug: 'laptops',
      slug: 'epsilon-book',
      name: 'Epsilon Book',
      brand: 'Lenovo',
      price: 700000,
      product_key_specs: {
        ram_gb: 8,
        storage_gb: 256,
      },
    }),
    makeProduct({
      category_slug: 'laptops',
      slug: 'zeta-book',
      name: 'Zeta Book',
      brand: 'HP',
      price: 650000,
      product_key_specs: {
        ram_gb: 8,
        storage_gb: 512,
      },
    }),
  ];
}

export function buildSmartTvProducts(): CategoryHubProduct[] {
  return [
    makeProduct({
      category_slug: 'smart-tvs',
      slug: 'alpha-tv',
      name: 'Alpha TV',
      brand: 'Samsung',
      price: 1200000,
      product_key_specs: {
        screen_size_inches: 55,
        refresh_rate_hz: 120,
      },
    }),
    makeProduct({
      category_slug: 'smart-tvs',
      slug: 'beta-tv',
      name: 'Beta TV',
      brand: 'LG',
      price: 1350000,
      product_key_specs: {
        screen_size_inches: 65,
        refresh_rate_hz: 60,
      },
    }),
    makeProduct({
      category_slug: 'smart-tvs',
      slug: 'gamma-tv',
      name: 'Gamma TV',
      brand: 'Samsung',
      price: 980000,
      product_key_specs: {
        screen_size_inches: 50,
        refresh_rate_hz: 120,
      },
    }),
    makeProduct({
      category_slug: 'smart-tvs',
      slug: 'delta-tv',
      name: 'Delta TV',
      brand: 'Sony',
      price: 1500000,
      product_key_specs: {
        screen_size_inches: 75,
        refresh_rate_hz: 144,
      },
    }),
    makeProduct({
      category_slug: 'smart-tvs',
      slug: 'epsilon-tv',
      name: 'Epsilon TV',
      brand: 'LG',
      price: 990000,
      product_key_specs: {
        screen_size_inches: 55,
        refresh_rate_hz: 120,
      },
    }),
    makeProduct({
      category_slug: 'smart-tvs',
      slug: 'zeta-tv',
      name: 'Zeta TV',
      brand: 'Sony',
      price: 1100000,
      product_key_specs: {
        screen_size_inches: 58,
        refresh_rate_hz: 120,
      },
    }),
  ];
}
