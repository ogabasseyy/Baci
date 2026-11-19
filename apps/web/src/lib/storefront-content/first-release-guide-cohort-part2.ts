import type { FirstReleaseCohortPdpEntry } from './first-release-guide-cohort-types';

export const FIRST_RELEASE_COHORT_PART_2: FirstReleaseCohortPdpEntry[] = [
  {
    productId: 'prod-mba-m3',
    productSlug: 'macbook-air-m3',
    productName: 'MacBook Air M3',
    categorySlug: 'laptops',
    brand: 'Apple',
    canonicalRouteAliases: [
      '/laptops/macbook-air-m3',
      '/products/macbook-air-m3',
    ],
    selectionReason: 'High volume consumer laptop',
    priorityGroup: 'high_traffic_pdp',
    expectedGuides: [
      { postSlug: 'macbook-air-guide', eligibilityReason: 'subject_primary' },
      {
        postSlug: 'apple-laptops-guide',
        eligibilityReason: 'brand_family_guide',
      },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
  {
    productId: 'prod-alienware-m18',
    productSlug: 'alienware-m18',
    productName: 'Dell Alienware m18',
    categorySlug: 'gaming-laptops',
    brand: 'Dell',
    canonicalRouteAliases: [
      '/gaming-laptops/alienware-m18',
      '/products/alienware-m18',
    ],
    selectionReason: 'Declared comparison participant in laptop shootout',
    priorityGroup: 'general_catalog',
    expectedGuides: [
      {
        postSlug: 'alienware-vs-rog-vs-omen',
        eligibilityReason: 'subject_comparison',
      },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
  {
    productId: 'prod-rog-g16',
    productSlug: 'asus-rog-zephyrus-g16',
    productName: 'ASUS ROG Zephyrus G16',
    categorySlug: 'gaming-laptops',
    brand: 'ASUS',
    canonicalRouteAliases: [
      '/gaming-laptops/asus-rog-zephyrus-g16',
      '/products/asus-rog-zephyrus-g16',
    ],
    selectionReason: 'Declared comparison participant in laptop shootout',
    priorityGroup: 'general_catalog',
    expectedGuides: [
      {
        postSlug: 'alienware-vs-rog-vs-omen',
        eligibilityReason: 'subject_comparison',
      },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
  {
    productId: 'prod-legion-pro-7',
    productSlug: 'lenovo-legion-pro-7',
    productName: 'Lenovo Legion Pro 7',
    categorySlug: 'gaming-laptops',
    brand: 'Lenovo',
    canonicalRouteAliases: [
      '/gaming-laptops/lenovo-legion-pro-7',
      '/products/lenovo-legion-pro-7',
    ],
    selectionReason: 'Declared comparison participant in laptop shootout',
    priorityGroup: 'general_catalog',
    expectedGuides: [
      {
        postSlug: 'alienware-vs-rog-vs-omen',
        eligibilityReason: 'subject_comparison',
      },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
  {
    productId: 'prod-pixel-9-pro',
    productSlug: 'pixel-9-pro',
    productName: 'Google Pixel 9 Pro',
    categorySlug: 'smartphones',
    brand: 'Google',
    canonicalRouteAliases: [
      '/smartphones/pixel-9-pro',
      '/products/pixel-9-pro',
    ],
    selectionReason: 'High interest AI smartphone',
    priorityGroup: 'general_catalog',
    expectedGuides: [
      {
        postSlug: 'google-pixel-9-pro-guide',
        eligibilityReason: 'subject_primary',
      },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
  {
    productId: 'prod-ipad-pro-13',
    productSlug: 'ipad-pro-13-m4',
    productName: 'Apple iPad Pro 13 M4',
    categorySlug: 'tablets',
    brand: 'Apple',
    canonicalRouteAliases: [
      '/tablets/ipad-pro-13-m4',
      '/products/ipad-pro-13-m4',
    ],
    selectionReason: 'Category guide verification with brand restriction',
    priorityGroup: 'high_traffic_pdp',
    expectedGuides: [
      { postSlug: 'ipad-guide', eligibilityReason: 'category_guide' },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
  {
    productId: 'prod-tab-s9',
    productSlug: 'galaxy-tab-s9',
    productName: 'Samsung Galaxy Tab S9',
    categorySlug: 'tablets',
    brand: 'Samsung',
    canonicalRouteAliases: [
      '/tablets/galaxy-tab-s9',
      '/products/galaxy-tab-s9',
    ],
    selectionReason: 'Brand family guide in non-smartphone category',
    priorityGroup: 'general_catalog',
    expectedGuides: [
      {
        postSlug: 'samsung-galaxy-tab-guide',
        eligibilityReason: 'brand_family_guide',
      },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
  {
    productId: 'prod-sony-wh1000xm5',
    productSlug: 'sony-wh-1000xm5',
    productName: 'Sony WH-1000XM5',
    categorySlug: 'audio',
    brand: 'Sony',
    canonicalRouteAliases: [
      '/audio/sony-wh-1000xm5',
      '/products/sony-wh-1000xm5',
    ],
    selectionReason: 'Audio category brand family guide recipient',
    priorityGroup: 'general_catalog',
    expectedGuides: [
      { postSlug: 'sony-audio-guide', eligibilityReason: 'brand_family_guide' },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
  {
    productId: 'prod-airpods-pro-2',
    productSlug: 'airpods-pro-2',
    productName: 'Apple AirPods Pro 2',
    categorySlug: 'earbuds',
    brand: 'Apple',
    canonicalRouteAliases: [
      '/earbuds/airpods-pro-2',
      '/products/airpods-pro-2',
    ],
    selectionReason: 'High volume accessory with dedicated product guide',
    priorityGroup: 'high_traffic_pdp',
    expectedGuides: [
      { postSlug: 'airpods-pro-2-guide', eligibilityReason: 'subject_primary' },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
  {
    productId: 'prod-switch-oled',
    productSlug: 'nintendo-switch-oled',
    productName: 'Nintendo Switch OLED',
    categorySlug: 'nintendo-switch',
    brand: 'Nintendo',
    canonicalRouteAliases: [
      '/nintendo-switch/nintendo-switch-oled',
      '/products/nintendo-switch-oled',
    ],
    selectionReason: 'Dedicated handheld gaming category guide recipient',
    priorityGroup: 'high_traffic_pdp',
    expectedGuides: [
      {
        postSlug: 'nintendo-switch-guide',
        eligibilityReason: 'category_guide',
      },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
];
