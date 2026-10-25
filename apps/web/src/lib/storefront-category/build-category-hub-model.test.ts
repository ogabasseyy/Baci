import { describe, expect, it } from 'vitest';
import { CATEGORY_HUB_DEFAULTS } from '@/config/category-hub-defaults';
import { buildCategoryHubModel } from '@/lib/storefront-category/build-category-hub-model';
import {
  buildLaptopProducts,
  buildSmartphoneProducts,
  buildSmartTvProducts,
  makeProduct,
} from '@/lib/storefront-category/build-category-hub-model.test-support';

const publishedGuidePosts = [
  {
    slug: 'best-phones-in-nigeria',
    title: 'Best Phones in Nigeria',
    excerpt: 'Budget and flagship phone picks.',
    category: 'Smartphones',
    tags: ['smartphones', 'budget', 'iphone'],
    keywords: ['android', 'battery'],
    featured_image_url: null,
    published_at: '2026-04-10T09:00:00.000Z',
    reading_time_minutes: 6,
  },
  {
    slug: 'apple-vs-samsung-buying-guide',
    title: 'Apple vs Samsung Buying Guide',
    excerpt: 'Which ecosystem fits you.',
    category: 'Smartphones',
    tags: ['smartphones', 'apple', 'samsung'],
    keywords: ['iphone', 'galaxy'],
    featured_image_url: null,
    published_at: '2026-04-09T09:00:00.000Z',
    reading_time_minutes: 5,
  },
];

describe('buildCategoryHubModel', () => {
  it('prefers merchant SEO over curated defaults', () => {
    const model = buildCategoryHubModel({
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      merchantBusinessName: 'Baci Mobile',
      storeUrl: 'https://store.test',
      products: buildSmartphoneProducts(),
      categorySeo: {
        heading: 'Merchant headline',
        description: 'Merchant description',
        features: ['Merchant feature'],
        faqs: [
          {
            question: 'Merchant question?',
            answer: 'Merchant answer.',
          },
        ],
      },
    });

    expect(model.intro.heading).toBe('Merchant headline');
    expect(model.intro.description).toBe('Merchant description');
    expect(model.trustFeatures).toEqual(['Merchant feature']);
    expect(model.faqItems).toEqual([
      {
        question: 'Merchant question?',
        answer: 'Merchant answer.',
      },
    ]);
  });

  it('prefers merchant seo_features and seo_faq even when heading and description are missing', () => {
    const model = buildCategoryHubModel({
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      merchantBusinessName: 'Baci Mobile',
      storeUrl: 'https://store.test',
      products: buildSmartphoneProducts(),
      categorySeo: {
        features: ['Merchant warranty', 'Merchant delivery'],
        faqs: [
          {
            question: 'Merchant FAQ?',
            answer: 'Merchant answer.',
          },
        ],
      },
    });

    expect(model.intro.source).toBe('curated');
    expect(model.trustFeatures).toEqual([
      'Merchant warranty',
      'Merchant delivery',
    ]);
    expect(model.faqItems).toEqual([
      {
        question: 'Merchant FAQ?',
        answer: 'Merchant answer.',
      },
    ]);
  });

  it('preserves collection SEO and suppresses phase 2 modules', () => {
    const model = buildCategoryHubModel({
      categorySlug: 'new-arrivals',
      categoryName: 'New Arrivals',
      merchantBusinessName: 'Baci Mobile',
      storeUrl: 'https://store.test',
      products: buildSmartphoneProducts(),
      isCollection: true,
      collectionSeo: {
        heading: 'New Arrivals',
        description: 'Fresh additions from the store.',
        features: ['Fresh stock', 'Recently added'],
        faqs: [
          {
            question: 'How often is this updated?',
            answer: 'Every day.',
          },
        ],
      },
    });

    expect(model.intro).toEqual({
      heading: 'New Arrivals',
      description: 'Fresh additions from the store.',
      source: 'merchant',
    });
    expect(model.trustFeatures).toEqual(['Fresh stock', 'Recently added']);
    expect(model.faqItems).toEqual([
      {
        question: 'How often is this updated?',
        answer: 'Every day.',
      },
    ]);
    expect(model.bestForCards).toEqual([]);
    expect(model.brandCards).toEqual([]);
    expect(model.priceBandCards).toEqual([]);
    expect(model.comparisonLinks).toEqual([]);
    expect(model.guideLinks).toEqual([]);
  });

  it('uses curated defaults for priority categories when merchant SEO is missing', () => {
    const model = buildCategoryHubModel({
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      merchantBusinessName: 'Baci Mobile',
      storeUrl: 'https://store.test',
      products: buildSmartphoneProducts(),
    });

    expect(model.intro.heading).toBe(
      CATEGORY_HUB_DEFAULTS.smartphones.intro.heading
    );
    expect(model.intro.description).toBe(
      CATEGORY_HUB_DEFAULTS.smartphones.intro.description
    );
    expect(model.trustFeatures).toEqual(
      CATEGORY_HUB_DEFAULTS.smartphones.trustFeatures
    );
    expect(model.faqItems).toEqual(CATEGORY_HUB_DEFAULTS.smartphones.faqItems);
  });

  it('returns a bounded fallback intro and no cards for non-priority categories', () => {
    const model = buildCategoryHubModel({
      categorySlug: 'headphones',
      categoryName: 'Headphones',
      merchantBusinessName: 'Baci Mobile',
      storeUrl: 'https://store.test',
      products: [
        makeProduct({
          category_slug: 'headphones',
          slug: 'sony-headphone',
          name: 'Sony Headphone',
          brand: 'Sony',
          price: 45000,
          product_key_specs: {},
        }),
        makeProduct({
          category_slug: 'headphones',
          slug: 'anker-headphone',
          name: 'Anker Headphone',
          brand: 'Anker',
          price: 55000,
          product_key_specs: {},
        }),
        makeProduct({
          category_slug: 'headphones',
          slug: 'jbl-headphone',
          name: 'JBL Headphone',
          brand: 'JBL',
          price: 65000,
          product_key_specs: {},
        }),
        makeProduct({
          category_slug: 'headphones',
          slug: 'nokia-headphone',
          name: 'Nokia Headphone',
          brand: 'Nokia',
          price: 75000,
          product_key_specs: {},
        }),
      ],
    });

    expect(model.intro.source).toBe('fallback');
    expect(model.intro.description).toContain('Baci Mobile');
    expect(model.intro.description).toContain('Headphones');
    expect(model.intro.description).toContain('4 active products');
    expect(model.intro.description).toContain('Nokia');
    expect(model.intro.description).toContain('JBL');
    expect(model.intro.description).toContain('Anker');
    expect(model.intro.description).not.toContain('Sony');
    expect(model.intro.description).not.toContain('Sony, Anker, JBL');
    expect(model.intro.description.length).toBeLessThan(220);
    expect(model.bestForCards).toEqual([]);
    expect(model.brandCards).toEqual([]);
    expect(model.priceBandCards).toEqual([]);
    expect(model.comparisonLinks).toEqual([]);
    expect(model.guideLinks).toEqual([]);
  });

  it('builds deterministic smartphone cards, price bands, and compare links', () => {
    const model = buildCategoryHubModel({
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      merchantBusinessName: 'Baci Mobile',
      storeUrl: 'https://store.test',
      products: buildSmartphoneProducts(),
      guidePosts: [...publishedGuidePosts],
    });

    expect(model.bestForCards.map((card) => card.title)).toEqual([
      'Best for Photography',
      'Best for Battery Life',
      'Best Budget Phones',
    ]);
    expect(model.bestForCards.map((card) => card.href)).toEqual([
      'https://store.test/smartphones/apple-pro',
      'https://store.test/smartphones/beta-phone',
      'https://store.test/smartphones/samsung-a',
    ]);

    expect(model.priceBandCards.map((card) => card.title)).toEqual([
      CATEGORY_HUB_DEFAULTS.smartphones.priceBands[0].title,
      CATEGORY_HUB_DEFAULTS.smartphones.priceBands[1].title,
    ]);
    expect(model.priceBandCards.map((card) => card.href)).toEqual([
      'https://store.test/smartphones/best-under/under-500k',
      'https://store.test/smartphones/best-under/under-1m',
    ]);

    expect(model.brandCards.map((card) => card.title)).toEqual([
      'Apple Mini',
      'Samsung A',
      'Tecno C',
    ]);
    expect(model.brandCards.map((card) => card.href)).toEqual([
      'https://store.test/smartphones/apple-mini',
      'https://store.test/smartphones/samsung-a',
      'https://store.test/smartphones/tecno-c',
    ]);
    expect(model.brandCards[0]).toEqual(
      expect.objectContaining({
        secondaryHref:
          'https://store.test/smartphones/compare/apple-vs-samsung',
        secondaryLabel: 'Compare Apple vs Samsung',
      })
    );
    expect(model.brandCards[1]).toEqual(
      expect.objectContaining({
        secondaryHref:
          'https://store.test/smartphones/compare/apple-vs-samsung',
        secondaryLabel: 'Compare Apple vs Samsung',
      })
    );
    expect(model.brandCards[2]).not.toHaveProperty('secondaryHref');
    expect(model.brandCards[2]).not.toHaveProperty('secondaryLabel');

    expect(model.comparisonLinks).toEqual([
      {
        href: 'https://store.test/smartphones/compare/alpha-phone-vs-beta-phone',
        label: 'Alpha Phone vs Beta Phone',
      },
      {
        href: 'https://store.test/smartphones/compare/apple-vs-samsung',
        label: 'Apple vs Samsung',
      },
      {
        href: 'https://store.test/smartphones/best-under/under-500k',
        label: 'Best Smartphones Under ₦500,000',
      },
    ]);
    expect(model.guideLinks).toEqual([
      {
        href: 'https://store.test/blog/best-phones-in-nigeria',
        title: 'Best Phones in Nigeria',
        description: 'Budget and flagship phone picks.',
        kind: 'best-in-nigeria',
      },
      {
        href: 'https://store.test/blog/apple-vs-samsung-buying-guide',
        title: 'Apple vs Samsung Buying Guide',
        description: 'Which ecosystem fits you.',
        kind: 'decision-support',
      },
    ]);
  });

  it('links five inventory-qualified smartphone brands to authority hubs', () => {
    const products = Array.from({ length: 5 }, (_, productIndex) =>
      makeProduct({
        brand: 'Samsung',
        name: `Samsung Phone ${productIndex}`,
        slug: `samsung-phone-${productIndex}`,
        price: 100_000 + productIndex,
      })
    );
    const model = buildCategoryHubModel({
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      merchantBusinessName: 'Ogabassey',
      storeUrl: 'https://ogabassey.com',
      products,
      brandAuthorityEntries: [
        ['samsung', 'Samsung', 50],
        ['google', 'Google Pixel', 19],
        ['infinix', 'Infinix', 18],
        ['tecno', 'Tecno', 15],
        ['itel', 'Itel', 29],
      ].map(([brandKey, displayName, productCount]) => ({
        brandKey: String(brandKey),
        brandQueryValue:
          String(brandKey) === 'google' ? 'Google' : String(displayName),
        categorySlug: 'smartphones',
        displayName: String(displayName),
        minimumProducts: 5,
        productCount: Number(productCount),
      })),
    });

    expect(model.brandCards.map((card) => card.title)).toEqual([
      'Samsung',
      'Google Pixel',
      'Infinix',
      'Tecno',
      'Itel',
    ]);
    expect(model.brandCards.map((card) => card.href)).toEqual([
      'https://ogabassey.com/smartphones/brands/samsung',
      'https://ogabassey.com/smartphones/brands/google',
      'https://ogabassey.com/smartphones/brands/infinix',
      'https://ogabassey.com/smartphones/brands/tecno',
      'https://ogabassey.com/smartphones/brands/itel',
    ]);
  });

  it('backfills explicit authority cards with distinct top-selling brands', () => {
    const model = buildCategoryHubModel({
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      merchantBusinessName: 'Ogabassey',
      storeUrl: 'https://ogabassey.com',
      products: [
        ...Array.from({ length: 5 }, (_, index) =>
          makeProduct({
            brand: 'Samsung',
            name: `Samsung ${index}`,
            slug: `samsung-${index}`,
          })
        ),
        ...Array.from({ length: 4 }, (_, index) =>
          makeProduct({
            brand: 'Tecno',
            name: `Tecno ${index}`,
            slug: `tecno-${index}`,
          })
        ),
        ...Array.from({ length: 3 }, (_, index) =>
          makeProduct({
            brand: 'Infinix',
            name: `Infinix ${index}`,
            slug: `infinix-${index}`,
          })
        ),
      ],
      brandAuthorityEntries: [
        {
          brandKey: 'samsung',
          brandQueryValue: 'Samsung',
          categorySlug: 'smartphones',
          displayName: 'Samsung',
          minimumProducts: 5,
          productCount: 48,
          productCountIsLowerBound: true,
        },
      ],
    });

    expect(model.brandCards.map((card) => card.title)).toEqual([
      'Samsung',
      'Tecno 0',
      'Infinix 0',
    ]);
    expect(model.brandCards[0]?.href).toBe(
      'https://ogabassey.com/smartphones/brands/samsung'
    );
    expect(model.brandCards[0]?.description).toBe(
      '48+ active products in this category.'
    );
  });

  it.each([
    [
      'laptops',
      buildLaptopProducts(),
      [
        'Best for Work and School',
        'Best for Performance',
        'Best Budget Laptops',
      ],
    ],
    [
      'smart-tvs',
      buildSmartTvProducts(),
      [
        'Best for Big-Screen Viewing',
        'Best for Fast Motion',
        'Best Budget Smart TVs',
      ],
    ],
  ] as const)('builds deterministic best-for cards for %s', (categorySlug, products, expectedTitles) => {
    const model = buildCategoryHubModel({
      categorySlug,
      categoryName: categorySlug === 'laptops' ? 'Laptops' : 'Smart TVs',
      merchantBusinessName: 'Baci Mobile',
      storeUrl: 'https://store.test',
      products,
    });

    expect(model.bestForCards.map((card) => card.title)).toEqual(
      expectedTitles
    );
    expect(model.bestForCards).toHaveLength(expectedTitles.length);
  });
});
