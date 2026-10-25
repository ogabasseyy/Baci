import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCategoryHubSections = vi.fn();
const mockLoadCategoryPageCompareLinks = vi.fn();
const mockLoadPriceBandPage = vi.fn();
vi.mock('@/lib/storefront-compare/load-price-band-page', () => ({
  loadPriceBandPage: (...args: unknown[]) => mockLoadPriceBandPage(...args),
}));

vi.mock('@/components/storefront/ogabassey/seo/category-hub-sections', () => ({
  CategoryHubSections: ({
    hub,
    headingIdPrefix,
    comparisonHeading,
  }: {
    hub: {
      comparisonLinks: Array<{
        href: string;
        label: string;
      }>;
    };
    headingIdPrefix?: string;
    comparisonHeading?: string;
  }) =>
    mockCategoryHubSections({
      comparisonHeading,
      headingIdPrefix,
      hub,
    }) ?? (
      <section aria-label="Deferred category comparisons">
        {hub.comparisonLinks.map((link) => (
          <a href={link.href} key={link.href}>
            {link.label}
          </a>
        ))}
      </section>
    ),
}));

vi.mock('./category-page-compare-links', () => ({
  loadCategoryPageCompareLinks: (...args: unknown[]) =>
    mockLoadCategoryPageCompareLinks(...args),
}));

const { CategoryPageDeferredCompareLinks } = await import(
  './category-page-deferred-compare-links'
);

describe('CategoryPageDeferredCompareLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadPriceBandPage.mockResolvedValue(null);
  });

  it('renders crawlable category comparison links when the graph has entries', async () => {
    mockLoadCategoryPageCompareLinks.mockResolvedValueOnce([
      {
        href: 'https://store.example.com/smartphones/compare/a-vs-b',
        label: 'Product A vs Product B',
      },
    ]);

    const ui = await CategoryPageDeferredCompareLinks({
      storeUrl: 'https://store.example.com',
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
    });

    render(ui);

    expect(
      screen.getByRole('link', { name: 'Product A vs Product B' })
    ).toHaveAttribute(
      'href',
      'https://store.example.com/smartphones/compare/a-vs-b'
    );
    expect(mockCategoryHubSections).toHaveBeenCalledWith(
      expect.objectContaining({
        comparisonHeading: 'More product comparisons',
        headingIdPrefix: 'maintained-category-comparisons',
      })
    );
  });

  it('renders nothing when no graph comparison links are available', async () => {
    mockLoadCategoryPageCompareLinks.mockResolvedValueOnce([]);

    const ui = await CategoryPageDeferredCompareLinks({
      storeUrl: 'https://store.example.com',
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
    });

    expect(ui).toBeNull();
  });
  it('links to the eligible canonical laptop guide even without comparison pairs', async () => {
    mockLoadCategoryPageCompareLinks.mockResolvedValueOnce([]);
    mockLoadPriceBandPage.mockResolvedValueOnce({ isIndexable: true });
    const ui = await CategoryPageDeferredCompareLinks({
      storeUrl: 'https://store.example.com',
      merchantId: 'merchant-1',
      merchantSlug: 'store',
      categorySlug: 'laptops',
      categoryName: 'Laptops',
    });
    render(ui);
    expect(
      screen.getByRole('link', { name: 'Compare Laptops Under ₦1,000,000' })
    ).toHaveAttribute(
      'href',
      'https://store.example.com/laptops/best-under/under-1m'
    );
    expect(mockLoadPriceBandPage).toHaveBeenCalledWith(
      {
        merchantSlug: 'store',
        categorySlug: 'laptops',
        priceBandSlug: 'under-1m',
      },
      { includeRequestPathPrefix: false }
    );
  });

  it('omits an ineligible laptop guide', async () => {
    mockLoadCategoryPageCompareLinks.mockResolvedValueOnce([]);
    mockLoadPriceBandPage.mockResolvedValueOnce({ isIndexable: false });
    expect(
      await CategoryPageDeferredCompareLinks({
        storeUrl: 'https://store.example.com',
        merchantId: 'merchant-1',
        merchantSlug: 'store',
        categorySlug: 'laptops',
        categoryName: 'Laptops',
      })
    ).toBeNull();
  });
  it('keeps existing comparison navigation when the optional guide loader fails', async () => {
    mockLoadCategoryPageCompareLinks.mockResolvedValueOnce([
      { href: '/laptops/compare/a-vs-b', label: 'Laptop A vs B' },
    ]);
    mockLoadPriceBandPage.mockRejectedValueOnce(
      new Error('public inventory unavailable')
    );
    render(
      await CategoryPageDeferredCompareLinks({
        storeUrl: 'https://store.example.com',
        merchantId: 'merchant-1',
        merchantSlug: 'store',
        categorySlug: 'laptops',
        categoryName: 'Laptops',
      })
    );
    expect(screen.getByRole('link', { name: 'Laptop A vs B' })).toHaveAttribute(
      'href',
      '/laptops/compare/a-vs-b'
    );
    expect(
      screen.queryByRole('link', { name: /Under/ })
    ).not.toBeInTheDocument();
  });
});
