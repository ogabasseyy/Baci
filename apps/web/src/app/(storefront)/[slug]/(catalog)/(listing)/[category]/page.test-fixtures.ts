export function makeSmartphoneProduct(
  index: number,
  overrides: Partial<{
    name: string;
    slug: string;
    brand: string;
    price: number;
    main_camera_mp: number;
    battery_mah: number;
    charging_watt: number;
    ram_gb: number;
    storage_gb: number;
    screen_size_inches: number;
  }> = {}
) {
  return {
    id: `product-${index}`,
    name: overrides.name ?? `Phone ${index}`,
    slug: overrides.slug ?? `phone-${index}`,
    description: `Description ${index}`,
    price: overrides.price ?? 300000 + index * 1000,
    image: `https://cdn.example.com/product-${index}.png`,
    images: [`https://cdn.example.com/product-${index}.png`],
    category: 'Smartphones',
    brand: overrides.brand ?? 'Tecno',
    condition: 'new',
    stock: 5,
    category_slug: 'smartphones',
    product_key_specs: {
      main_camera_mp: overrides.main_camera_mp ?? 48,
      battery_mah: overrides.battery_mah ?? 5000,
      charging_watt: overrides.charging_watt ?? 33,
      ram_gb: overrides.ram_gb ?? 8,
      storage_gb: overrides.storage_gb ?? 128,
      screen_size_inches: overrides.screen_size_inches ?? 6.6,
    },
  };
}

export const smartphoneHubProducts = [
  makeSmartphoneProduct(1, {
    name: 'Alpha Phone',
    slug: 'alpha-phone',
    brand: 'Apple',
    price: 420000,
    main_camera_mp: 50,
    battery_mah: 5000,
    charging_watt: 33,
  }),
  makeSmartphoneProduct(2, {
    name: 'Beta Phone',
    slug: 'beta-phone',
    brand: 'Samsung',
    price: 460000,
    main_camera_mp: 64,
    battery_mah: 6000,
    charging_watt: 45,
    ram_gb: 12,
    storage_gb: 256,
  }),
  makeSmartphoneProduct(3, {
    name: 'Apple Mini',
    slug: 'apple-mini',
    brand: 'Apple',
    price: 390000,
    main_camera_mp: 48,
    battery_mah: 4700,
  }),
  makeSmartphoneProduct(4, {
    name: 'Apple Pro',
    slug: 'apple-pro',
    brand: 'Apple',
    price: 490000,
    main_camera_mp: 108,
    battery_mah: 6000,
    charging_watt: 45,
    ram_gb: 12,
    storage_gb: 256,
  }),
  makeSmartphoneProduct(5, {
    name: 'Samsung A',
    slug: 'samsung-a',
    brand: 'Samsung',
    price: 350000,
    main_camera_mp: 48,
    battery_mah: 5000,
  }),
  makeSmartphoneProduct(6, {
    name: 'Samsung B',
    slug: 'samsung-b',
    brand: 'Samsung',
    price: 480000,
    main_camera_mp: 50,
    battery_mah: 5000,
    charging_watt: 25,
    ram_gb: 12,
    storage_gb: 256,
  }),
  makeSmartphoneProduct(7, {
    name: 'Tecno C',
    slug: 'tecno-c',
    brand: 'Tecno',
    price: 470000,
    main_camera_mp: 32,
    battery_mah: 5000,
  }),
  makeSmartphoneProduct(8, {
    name: 'Tecno Spark',
    slug: 'tecno-spark',
    brand: 'Tecno',
    price: 220000,
  }),
  makeSmartphoneProduct(9, {
    name: 'Infinix Zero',
    slug: 'infinix-zero',
    brand: 'Infinix',
    price: 240000,
    charging_watt: 45,
  }),
  makeSmartphoneProduct(10, {
    name: 'Xiaomi Redmi',
    slug: 'xiaomi-redmi',
    brand: 'Xiaomi',
    price: 260000,
    battery_mah: 5100,
  }),
  makeSmartphoneProduct(11, {
    name: 'Nokia G',
    slug: 'nokia-g',
    brand: 'Nokia',
    price: 280000,
    main_camera_mp: 50,
  }),
  makeSmartphoneProduct(12, {
    name: 'Itel Vision',
    slug: 'itel-vision',
    brand: 'Itel',
    price: 180000,
    battery_mah: 5000,
  }),
  makeSmartphoneProduct(13, {
    name: 'Oppo Reno',
    slug: 'oppo-reno',
    brand: 'Oppo',
    price: 620000,
    main_camera_mp: 50,
    charging_watt: 65,
    ram_gb: 12,
    storage_gb: 256,
  }),
  makeSmartphoneProduct(14, {
    name: 'Vivo V',
    slug: 'vivo-v',
    brand: 'Vivo',
    price: 710000,
    main_camera_mp: 64,
    battery_mah: 5000,
    charging_watt: 66,
  }),
  makeSmartphoneProduct(15, {
    name: 'Pixel Prime',
    slug: 'pixel-prime',
    brand: 'Google',
    price: 890000,
    main_camera_mp: 50,
    battery_mah: 5000,
    ram_gb: 12,
    storage_gb: 256,
  }),
  makeSmartphoneProduct(16, {
    name: 'Motorola Edge',
    slug: 'motorola-edge',
    brand: 'Motorola',
    price: 530000,
    charging_watt: 68,
  }),
  makeSmartphoneProduct(17, {
    name: 'Honor Magic',
    slug: 'honor-magic',
    brand: 'Honor',
    price: 580000,
    main_camera_mp: 54,
    battery_mah: 5100,
    charging_watt: 66,
  }),
  makeSmartphoneProduct(18, {
    name: 'Huawei Nova',
    slug: 'huawei-nova',
    brand: 'Huawei',
    price: 640000,
    main_camera_mp: 50,
    battery_mah: 5000,
    charging_watt: 66,
  }),
  makeSmartphoneProduct(19, {
    name: 'Realme GT',
    slug: 'realme-gt',
    brand: 'Realme',
    price: 520000,
    battery_mah: 5000,
    charging_watt: 80,
  }),
  makeSmartphoneProduct(20, {
    name: 'OnePlus Ace',
    slug: 'oneplus-ace',
    brand: 'OnePlus',
    price: 760000,
    main_camera_mp: 50,
    battery_mah: 5100,
    charging_watt: 100,
  }),
  makeSmartphoneProduct(21, {
    name: 'Nothing Phone',
    slug: 'nothing-phone',
    brand: 'Nothing',
    price: 690000,
    main_camera_mp: 50,
    battery_mah: 4700,
    charging_watt: 45,
  }),
];

export const headphoneProducts = [
  {
    ...makeSmartphoneProduct(31, {
      name: 'Sony Headphone',
      slug: 'sony-headphone',
      brand: 'Sony',
      price: 45000,
    }),
    category: 'Headphones',
    category_slug: 'headphones',
  },
  {
    ...makeSmartphoneProduct(32, {
      name: 'Anker Headphone',
      slug: 'anker-headphone',
      brand: 'Anker',
      price: 55000,
    }),
    category: 'Headphones',
    category_slug: 'headphones',
  },
  {
    ...makeSmartphoneProduct(33, {
      name: 'JBL Headphone',
      slug: 'jbl-headphone',
      brand: 'JBL',
      price: 65000,
    }),
    category: 'Headphones',
    category_slug: 'headphones',
  },
  {
    ...makeSmartphoneProduct(34, {
      name: 'Nokia Headphone',
      slug: 'nokia-headphone',
      brand: 'Nokia',
      price: 75000,
    }),
    category: 'Headphones',
    category_slug: 'headphones',
  },
];
