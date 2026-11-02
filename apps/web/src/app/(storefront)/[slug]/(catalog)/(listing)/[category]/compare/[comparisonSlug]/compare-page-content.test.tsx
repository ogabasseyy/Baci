import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadComparePage = vi.fn();
const mockCompareRelatedLinks = vi.fn(
  (props: {
    links: Array<{ description: string; href: string; label: string }>;
    storeUrl: string;
  }) => (
    <section aria-labelledby="related-comparisons-heading">
      <h2 id="related-comparisons-heading">More comparisons to check</h2>
      {props.links.map((link) => (
        <a href={link.href} key={link.href}>
          {link.label}
        </a>
      ))}
    </section>
  )
);

vi.mock('@/lib/storefront-compare/load-compare-page', () => ({
  loadComparePage: (...args: unknown[]) => mockLoadComparePage(...args),
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: (value: unknown) => JSON.stringify(value),
}));

vi.mock('./compare-related-links', () => ({
  CompareRelatedLinks: (props: {
    links: Array<{ description: string; href: string; label: string }>;
    storeUrl: string;
  }) => mockCompareRelatedLinks(props),
}));

const comparePageModel = {
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

describe('ComparePageContent', () => {
  beforeEach(() => {
    mockLoadComparePage.mockReset();
    mockCompareRelatedLinks.mockClear();
    mockLoadComparePage.mockResolvedValue(comparePageModel);
  });

  it('renders the verdict, key differences, and comparison table', async () => {
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    expect(
      screen.getByRole('heading', {
        name: /iPhone 17 Pro Max vs Samsung Galaxy Z TriFold/i,
      })
    ).toHaveAttribute('data-cwv-lcp-copy', 'compare');
    expect(
      screen.getByText(/Both phones target flagship buyers/i)
    ).toHaveAttribute('data-cwv-lcp-copy', 'authority-hub');
    expect(
      screen.getByRole('table', { name: /Product comparison table/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'How to use this comparison' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Check the verdict first, then review the differences/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Best Phones in Nigeria' })
    ).toHaveAttribute(
      'href',
      'https://ogabassey.com/blog/best-phones-in-nigeria'
    );
    expect(
      screen.getByRole('heading', { name: 'More comparisons to check' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: 'Compare iPhone 17 Pro Max with Galaxy S24 FE',
      })
    ).toHaveAttribute(
      'href',
      '/smartphones/compare/galaxy-s24-fe-vs-iphone-17-pro-max'
    );
    expect(mockCompareRelatedLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        links: comparePageModel.relatedCompareLinks,
        storeUrl: 'https://ogabassey.com',
      })
    );
    expect(container.querySelectorAll('tbody')).toHaveLength(1);
  });

  it('renders each comparison row group in its own table body', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      comparisonMatrix: {
        ...comparePageModel.comparisonMatrix,
        groups: [
          ...comparePageModel.comparisonMatrix.groups,
          {
            category: 'Battery',
            rows: [
              {
                label: 'Capacity',
                values: ['5000mAh', '5600mAh'],
                isDifferent: true,
              },
            ],
          },
        ],
      },
    });
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    expect(container.querySelectorAll('tbody')).toHaveLength(2);
    expect(screen.getByRole('rowheader', { name: 'Platform' })).toHaveAttribute(
      'scope',
      'rowgroup'
    );
    expect(screen.getByRole('rowheader', { name: 'Battery' })).toHaveAttribute(
      'scope',
      'rowgroup'
    );
  });

  it('renders breadcrumb and product ItemList JSON-LD scripts while suppressing compare FAQPage markup', async () => {
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );

    expect(schemaScripts).toHaveLength(2);
    expect(schemaScripts[0]?.textContent).toContain('"@type":"BreadcrumbList"');
    expect(schemaScripts[1]?.textContent).toContain('"@type":"ItemList"');
    expect(schemaScripts[1]?.textContent).toContain('"@type":"Product"');
    expect(schemaScripts[1]?.textContent).not.toContain('"@type":"FAQPage"');
  });

  it('uses the resolved merchant currency in product ItemList JSON-LD offers', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      merchant: {
        ...comparePageModel.merchant,
        payout_currency: 'KES',
        country: 'KE',
      },
    });
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    const itemListSchema = JSON.parse(schemaScripts[1]?.textContent ?? '{}');

    expect(itemListSchema.itemListElement[0].item.offers.priceCurrency).toBe(
      'KES'
    );
  });

  it('falls back to NGN in product ItemList JSON-LD when the merchant has no payout currency', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      merchant: {
        ...comparePageModel.merchant,
        payout_currency: null,
        country: null,
      },
    });
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    const itemListSchema = JSON.parse(schemaScripts[1]?.textContent ?? '{}');

    expect(itemListSchema.itemListElement[0].item.offers.priceCurrency).toBe(
      'NGN'
    );
  });

  it('keeps string-encoded prices in product ItemList JSON-LD', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      rightProduct: {
        ...comparePageModel.rightProduct,
        price: '2300000',
      },
    });
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    const itemListSchema = JSON.parse(schemaScripts[1]?.textContent ?? '{}');

    expect(itemListSchema.itemListElement[1].item.offers.price).toBe(2_300_000);
  });

  it('resolves relative product images in product ItemList JSON-LD', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      rightProduct: {
        ...comparePageModel.rightProduct,
        image: '/media/samsung-galaxy-z-trifold.avif',
      },
    });
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    const itemListSchema = JSON.parse(schemaScripts[1]?.textContent ?? '{}');

    expect(itemListSchema.itemListElement[1].item.image).toEqual([
      'https://ogabassey.com/media/samsung-galaxy-z-trifold.avif',
    ]);
  });

  it('suppresses product ItemList JSON-LD when a compared product has no image', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      rightProduct: {
        ...comparePageModel.rightProduct,
        image: null,
      },
    });
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );

    expect(schemaScripts).toHaveLength(1);
    expect(schemaScripts[0]?.textContent).toContain('"@type":"BreadcrumbList"');
    expect(schemaScripts[0]?.textContent).not.toContain('"@type":"ItemList"');
  });

  it('suppresses product ItemList JSON-LD when a compared product only has a local placeholder image', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      rightProduct: {
        ...comparePageModel.rightProduct,
        image: '/placeholder.svg',
      },
    });
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );

    expect(schemaScripts).toHaveLength(1);
    expect(schemaScripts[0]?.textContent).toContain('"@type":"BreadcrumbList"');
    expect(schemaScripts[0]?.textContent).not.toContain('"@type":"ItemList"');
  });

  it('keeps product ItemList JSON-LD when visible FAQ items are absent', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      faqItems: [],
    });
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );

    expect(schemaScripts).toHaveLength(2);
    expect(schemaScripts[0]?.textContent).toContain('"@type":"BreadcrumbList"');
    expect(schemaScripts[1]?.textContent).toContain('"@type":"ItemList"');
    expect(schemaScripts[1]?.textContent).not.toContain('"@type":"FAQPage"');
  });

  it('uses brand names as table column labels for brand compare pages', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      kind: 'brand' as const,
      canonicalSlug: 'apple-vs-samsung',
      canonicalUrl:
        'https://ogabassey.com/smartphones/compare/apple-vs-samsung',
      metaTitle: 'Apple vs Samsung Smartphones | Ogabassey',
      metaDescription:
        'Compare Apple and Samsung smartphones by price range and active models.',
      heading: 'Apple vs Samsung Smartphones',
      summaryVerdict:
        'Apple and Samsung both matter for smartphone buyers, but their positioning differs.',
      keyDifferences: [
        'Apple has 3 active models in this category.',
        'Samsung has 5 active models in this category.',
      ],
      comparisonRows: [
        {
          label: 'Active models',
          leftValue: '3',
          rightValue: '5',
        },
      ],
      faqItems: [],
      breadcrumbItems: [
        { name: 'Ogabassey', url: 'https://ogabassey.com' },
        { name: 'Smartphones', url: 'https://ogabassey.com/smartphones' },
        {
          name: 'Apple vs Samsung Smartphones',
          url: 'https://ogabassey.com/smartphones/compare/apple-vs-samsung',
        },
      ],
      guideLinks: [],
      relatedCompareLinks: [],
      merchant: {
        payout_currency: 'NGN',
      },
      isIndexable: true,
      isLegacyFallback: false,
      leftBrand: 'Apple',
      rightBrand: 'Samsung',
    });
    const { ComparePageContent } = await import('./compare-page-content');

    render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'apple-vs-samsung',
        }),
      })) as ReactElement
    );

    expect(
      screen.getByRole('columnheader', { name: 'Apple' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Samsung' })
    ).toBeInTheDocument();
  });
});
