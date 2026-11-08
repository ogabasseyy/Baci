import { render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { comparePageModel } from './compare-page-content.test-fixtures';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

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

    const heading = screen.getByRole('heading', {
      name: /iPhone 17 Pro Max vs Samsung Galaxy Z TriFold/i,
    });
    const verdict = screen.getByText(/Both phones target flagship buyers/i);
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveAttribute('data-cwv-lcp-copy', 'compare');
    expect(verdict).toBeInTheDocument();
    expect(verdict).toHaveAttribute('data-cwv-lcp-copy', 'authority-hub');
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
