export const comparePageModel = {
  kind: 'product' as const,
  canonicalSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
  canonicalUrl:
    'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
  metaTitle: 'iPhone 17 Pro Max vs Samsung Galaxy Z TriFold | Ogabassey',
  metaDescription:
    'Compare iPhone 17 Pro Max and Samsung Galaxy Z TriFold specs, pricing, and buying advice.',
  heading: 'iPhone 17 Pro Max vs Samsung Galaxy Z TriFold',
  summaryVerdict:
    'Both phones target flagship buyers, but their strengths differ.',
  keyDifferences: [
    'Apple ecosystem vs foldable productivity',
    'Battery life vs multitasking',
  ],
  comparisonRows: [
    {
      label: 'Processor',
      leftValue: 'A19 Pro',
      rightValue: 'Snapdragon 8 Elite',
    },
  ],
  comparisonMatrix: {
    columns: [
      { productId: 'left-product', label: 'iPhone 17 Pro Max' },
      { productId: 'right-product', label: 'Samsung Galaxy Z TriFold' },
    ],
    groups: [
      {
        category: 'Platform',
        rows: [
          {
            label: 'Chipset',
            values: ['A19 Pro', 'Snapdragon 8 Elite'],
            isDifferent: true,
          },
        ],
      },
    ],
    flatRows: [
      {
        label: 'Chipset',
        values: ['A19 Pro', 'Snapdragon 8 Elite'],
        isDifferent: true,
      },
    ],
    differentiatingRowCount: 1,
  },
  faqItems: [
    {
      question: 'Which phone is better for multitasking?',
      answer: 'The TriFold.',
    },
  ],
  breadcrumbItems: [
    { name: 'Ogabassey', url: 'https://ogabassey.com' },
    { name: 'Smartphones', url: 'https://ogabassey.com/smartphones' },
    {
      name: 'iPhone 17 Pro Max vs Samsung Galaxy Z TriFold',
      url: 'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
    },
  ],
  guideLinks: [
    {
      href: 'https://ogabassey.com/blog/best-phones-in-nigeria',
      title: 'Best Phones in Nigeria',
      description: 'Budget and flagship picks.',
      kind: 'best-in-nigeria' as const,
    },
  ],
  relatedCompareLinks: [
    {
      href: '/smartphones/compare/galaxy-s24-fe-vs-iphone-17-pro-max',
      label: 'Compare iPhone 17 Pro Max with Galaxy S24 FE',
      description:
        'Compare price, specs, condition, and buying fit for iPhone 17 Pro Max and Galaxy S24 FE.',
      categorySlug: 'smartphones',
      comparisonSlug: 'galaxy-s24-fe-vs-iphone-17-pro-max',
      productSlugs: ['iphone-17-pro-max', 'galaxy-s24-fe'] as [string, string],
      productNames: ['iPhone 17 Pro Max', 'Galaxy S24 FE'] as [string, string],
      anchorProductSlug: 'iphone-17-pro-max',
      score: 32,
    },
  ],
  merchant: {
    custom_domain: 'ogabassey.com',
    payout_currency: 'NGN',
    slug: 'ogabassey',
  },
  isIndexable: true,
  isLegacyFallback: false,
  leftProduct: {
    id: 'left-product',
    image: 'https://cdn.ogabassey.com/products/iphone-17-pro-max.avif',
    name: 'iPhone 17 Pro Max',
    slug: 'iphone-17-pro-max',
    category_slug: 'smartphones',
    price: 2_200_000,
  },
  rightProduct: {
    id: 'right-product',
    image: 'https://cdn.ogabassey.com/products/samsung-galaxy-z-trifold.avif',
    name: 'Samsung Galaxy Z TriFold',
    slug: 'samsung-galaxy-z-trifold',
    category_slug: 'smartphones',
    price: 2_300_000,
  },
};
