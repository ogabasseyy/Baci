import type { FirstReleaseCohortPdpEntry } from './first-release-guide-cohort-types';

export const FIRST_RELEASE_COHORT_PART_1: FirstReleaseCohortPdpEntry[] = [
  {
    productId: 'prod-ea-sports-fc-27',
    productSlug: 'ea-sports-fc-27',
    productName: 'EA Sports FC 27',
    categorySlug: 'playstation-5',
    brand: 'EA Sports',
    canonicalRouteAliases: [
      '/playstation-5/ea-sports-fc-27',
      '/products/ea-sports-fc-27',
    ],
    selectionReason:
      'Confirmed wrong-product regression: prior inference linked HP Omen laptop guide to console game',
    priorityGroup: 'confirmed_cross_category_regression',
    expectedGuides: [],
    rejectedFixtures: [
      {
        postSlug: 'hp-omen-16-review',
        rejectionReason:
          'HP Omen laptop review is product_specific to HP Omen, not console game',
      },
      {
        postSlug: 'alienware-vs-rog-vs-omen',
        rejectionReason: 'Laptop comparison does not apply to PlayStation game',
      },
      {
        postSlug: 'playstation-5-guide',
        rejectionReason:
          'PS5 console guide requires Sony brand, does not apply to EA Sports game',
      },
    ],
    emptySectionReason:
      'No verified guide currently published for EA Sports FC 27; cross-category gaming laptop reviews rejected.',
  },
  {
    productId: 'prod-s25-ultra',
    productSlug: 'galaxy-s25-ultra',
    productName: 'Samsung Galaxy S25 Ultra',
    categorySlug: 'smartphones',
    brand: 'Samsung',
    canonicalRouteAliases: [
      '/smartphones/galaxy-s25-ultra',
      '/products/galaxy-s25-ultra',
    ],
    selectionReason:
      'Confirmed cross-model regression: prior priority list linked Galaxy A15 budget guide to flagship S25 Ultra',
    priorityGroup: 'confirmed_cross_category_regression',
    expectedGuides: [
      {
        postSlug: 'galaxy-s25-ultra-guide',
        eligibilityReason: 'subject_primary',
      },
      {
        postSlug: 'samsung-s25-troubleshooting',
        eligibilityReason: 'subject_product_support',
      },
    ],
    rejectedFixtures: [
      {
        postSlug: 'galaxy-a15-guide',
        rejectionReason:
          'Galaxy A15 budget guide is product_specific to A15 and invalid on S25 Ultra',
      },
    ],
    emptySectionReason: null,
  },
  {
    productId: 'prod-omen-16',
    productSlug: 'hp-omen-16',
    productName: 'HP Omen 16',
    categorySlug: 'gaming-laptops',
    brand: 'HP',
    canonicalRouteAliases: [
      '/gaming-laptops/hp-omen-16',
      '/products/hp-omen-16',
    ],
    selectionReason:
      'Legitimate target of HP Omen review and gaming laptop comparison',
    priorityGroup: 'confirmed_cross_category_regression',
    expectedGuides: [
      { postSlug: 'hp-omen-16-review', eligibilityReason: 'subject_primary' },
      {
        postSlug: 'alienware-vs-rog-vs-omen',
        eligibilityReason: 'subject_comparison',
      },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
  {
    productId: 'prod-iphone-16-pm',
    productSlug: 'iphone-16-pro-max',
    productName: 'iPhone 16 Pro Max',
    categorySlug: 'smartphones',
    brand: 'Apple',
    canonicalRouteAliases: [
      '/smartphones/iphone-16-pro-max',
      '/products/iphone-16-pro-max',
    ],
    selectionReason: 'Top traffic flagship smartphone',
    priorityGroup: 'high_traffic_pdp',
    expectedGuides: [
      {
        postSlug: 'iphone-16-pro-max-guide',
        eligibilityReason: 'subject_primary',
      },
      {
        postSlug: 'apple-smartphones-guide',
        eligibilityReason: 'brand_family_guide',
      },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
  {
    productId: 'prod-iphone-16',
    productSlug: 'iphone-16',
    productName: 'iPhone 16',
    categorySlug: 'smartphones',
    brand: 'Apple',
    canonicalRouteAliases: ['/smartphones/iphone-16', '/products/iphone-16'],
    selectionReason: 'High traffic base model smartphone',
    priorityGroup: 'high_traffic_pdp',
    expectedGuides: [
      { postSlug: 'iphone-16-guide', eligibilityReason: 'subject_primary' },
      {
        postSlug: 'apple-smartphones-guide',
        eligibilityReason: 'brand_family_guide',
      },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
  {
    productId: 'prod-galaxy-a15',
    productSlug: 'galaxy-a15',
    productName: 'Samsung Galaxy A15',
    categorySlug: 'smartphones',
    brand: 'Samsung',
    canonicalRouteAliases: ['/smartphones/galaxy-a15', '/products/galaxy-a15'],
    selectionReason: 'High volume budget smartphone',
    priorityGroup: 'high_traffic_pdp',
    expectedGuides: [
      { postSlug: 'galaxy-a15-guide', eligibilityReason: 'subject_primary' },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
  {
    productId: 'prod-ps5-slim',
    productSlug: 'playstation-5-slim',
    productName: 'PlayStation 5 Slim',
    categorySlug: 'playstation-5',
    brand: 'Sony',
    canonicalRouteAliases: [
      '/playstation-5/playstation-5-slim',
      '/products/playstation-5-slim',
    ],
    selectionReason: 'Core gaming console category guide recipient',
    priorityGroup: 'high_traffic_pdp',
    expectedGuides: [
      { postSlug: 'playstation-5-guide', eligibilityReason: 'category_guide' },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
  {
    productId: 'prod-ps5-pro',
    productSlug: 'playstation-5-pro',
    productName: 'PlayStation 5 Pro',
    categorySlug: 'playstation-5',
    brand: 'Sony',
    canonicalRouteAliases: [
      '/playstation-5/playstation-5-pro',
      '/products/playstation-5-pro',
    ],
    selectionReason: 'Enthusiast gaming console category guide recipient',
    priorityGroup: 'high_traffic_pdp',
    expectedGuides: [
      { postSlug: 'playstation-5-guide', eligibilityReason: 'category_guide' },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
  {
    productId: 'prod-nokia-g42',
    productSlug: 'nokia-g42',
    productName: 'Nokia G42 5G',
    categorySlug: 'smartphones',
    brand: 'Nokia',
    canonicalRouteAliases: ['/smartphones/nokia-g42', '/products/nokia-g42'],
    selectionReason:
      'Catalog identity verification for brand_family_guide without alias list edit',
    priorityGroup: 'general_catalog',
    expectedGuides: [
      {
        postSlug: 'nokia-smartphones-guide',
        eligibilityReason: 'brand_family_guide',
      },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
  {
    productId: 'prod-mbp-16',
    productSlug: 'macbook-pro-16-m3',
    productName: 'MacBook Pro 16 M3',
    categorySlug: 'laptops',
    brand: 'Apple',
    canonicalRouteAliases: [
      '/laptops/macbook-pro-16-m3',
      '/products/macbook-pro-16-m3',
    ],
    selectionReason: 'High traffic pro laptop',
    priorityGroup: 'high_traffic_pdp',
    expectedGuides: [
      { postSlug: 'macbook-pro-guide', eligibilityReason: 'subject_primary' },
      {
        postSlug: 'apple-laptops-guide',
        eligibilityReason: 'brand_family_guide',
      },
    ],
    rejectedFixtures: [],
    emptySectionReason: null,
  },
];
