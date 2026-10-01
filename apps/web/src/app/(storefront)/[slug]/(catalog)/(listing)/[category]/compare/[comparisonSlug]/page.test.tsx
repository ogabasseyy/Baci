import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockComparePageContent } = vi.hoisted(() => ({
  mockComparePageContent: vi.fn((_props: unknown) => (
    <div>Compare page content</div>
  )),
}));

const mockLoadComparePage = vi.fn();

vi.mock('@/lib/seo-utils', () => ({
  getIndexableRobotsMetadata: () => ({
    index: true,
    follow: true,
    'max-image-preview': 'large',
    'max-snippet': -1,
    'max-video-preview': -1,
  }),
}));

vi.mock('@/lib/storefront-compare/load-compare-page', () => ({
  loadComparePage: (...args: unknown[]) => mockLoadComparePage(...args),
}));

vi.mock('./compare-page-content', () => ({
  ComparePageContent: (props: unknown) => mockComparePageContent(props),
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
  isIndexable: true,
  leftProduct: {
    id: 'left-product',
    name: 'iPhone 17 Pro Max',
    slug: 'iphone-17-pro-max',
  },
  rightProduct: {
    id: 'right-product',
    name: 'Samsung Galaxy Z TriFold',
    slug: 'samsung-galaxy-z-trifold',
  },
};

beforeEach(() => {
  mockLoadComparePage.mockReset();
  mockComparePageContent.mockReset();
  mockComparePageContent.mockImplementation(() => (
    <div>Compare page content</div>
  ));
  mockLoadComparePage.mockResolvedValue(comparePageModel);
});

describe('compare page metadata', () => {
  it('defers compare first paint to the route loader while route params are pending', async () => {
    const { default: ComparePage } = await import('./page');
    mockComparePageContent.mockImplementation(() => {
      throw new Promise(() => {
        // Keep the compare page content suspended behind the route loader.
      });
    });

    render(
      <Suspense fallback={<div>Route loader fallback</div>}>
        <ComparePage
          params={Promise.resolve({
            slug: 'ogabassey',
            category: 'smartphones',
            comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
          })}
        />
      </Suspense>
    );

    expect(screen.getByText('Route loader fallback')).toBeInTheDocument();
    expect(screen.queryByText('Compare page content')).not.toBeInTheDocument();
  });

  it('emits canonical metadata for product compare pages', async () => {
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'ogabassey',
        category: 'smartphones',
        comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
      }),
    });

    expect(mockLoadComparePage).toHaveBeenCalledWith({
      merchantSlug: 'ogabassey',
      categorySlug: 'smartphones',
      comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
    });
    expect(metadata.title).toEqual({
      absolute: comparePageModel.metaTitle,
    });
    expect(metadata.alternates?.canonical).toContain(
      '/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold'
    );
  });

  it('returns marker-free noindex metadata when the compare page loader returns null', async () => {
    mockLoadComparePage.mockResolvedValueOnce(null);
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'ogabassey',
        category: 'smartphones',
        comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
      }),
    });

    expect(metadata).toMatchObject({
      title: 'Comparison not found',
      alternates: null,
      robots: { index: false, follow: true },
    });
  });

  it('returns marker-free noindex metadata for an unapproved compare model', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      isIndexable: false,
    });
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'ogabassey',
        category: 'smartphones',
        comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
      }),
    });

    expect(metadata).toMatchObject({
      title: 'Comparison not found',
      alternates: null,
      robots: { index: false, follow: true },
    });
  });

  it('propagates metadata loader errors instead of turning them into not-found metadata', async () => {
    const loaderError = new Error('compare metadata unavailable');
    mockLoadComparePage.mockRejectedValueOnce(loaderError);
    const { generateMetadata } = await import('./page');

    await expect(
      generateMetadata({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'laptops',
          comparisonSlug: 'dell-xps-15-9510-vs-macbook-air-13-inch-2020-intel',
        }),
      })
    ).rejects.toThrow(loaderError);
  });

  it('emits noindex metadata for legacy compare fallback pages', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      isIndexable: false,
      isLegacyFallback: true,
    });
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'ogabassey',
        category: 'smartphones',
        comparisonSlug: 'legacy-product-vs-current-product',
      }),
    });

    expect(metadata.robots).toMatchObject({
      index: false,
      follow: true,
      googleBot: {
        index: false,
        follow: true,
      },
    });
  });
});
