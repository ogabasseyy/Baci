import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetStorefrontPathPrefix = vi.fn();
const mockLoadBrandAuthorityPage = vi.fn();
const mockBrandAuthorityPageContent = vi.fn();

vi.mock('next/server', () => ({ connection: () => Promise.resolve() }));
vi.mock('@/app/(storefront)/[slug]/storefront-route-not-found-content', () => ({
  StorefrontRouteNotFoundContent: ({
    title,
    message,
    backHref,
  }: {
    title: string;
    message: string;
    backHref: string;
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{message}</p>
      <a href={backHref}>Back</a>
    </div>
  ),
}));
vi.mock('@/lib/storefront-category/load-brand-authority-page', () => ({
  brandAuthorityPageLoader: {
    getStorefrontPathPrefix: (...args: unknown[]) =>
      mockGetStorefrontPathPrefix(...args),
    load: (...args: unknown[]) => mockLoadBrandAuthorityPage(...args),
  },
}));
vi.mock('./brand-authority-page-content', () => ({
  BrandAuthorityPageContent: (props: unknown) => {
    mockBrandAuthorityPageContent(props);
    return <div>Brand authority content</div>;
  },
}));

describe('brandAuthorityPageRuntime', () => {
  beforeEach(() => vi.clearAllMocks());

  it('merges the request path prefix into the loaded page model', async () => {
    // Arrange
    const page = {
      merchant: { slug: 'ogabassey' },
      pathPrefix: '',
    };
    mockLoadBrandAuthorityPage.mockResolvedValue(page);
    mockGetStorefrontPathPrefix.mockResolvedValue('/ogabassey');
    const { brandAuthorityPageRuntime } = await import(
      './brand-authority-page-runtime'
    );

    // Act
    const element = await brandAuthorityPageRuntime.render({
      params: Promise.resolve({
        slug: 'ogabassey',
        category: 'smartphones',
        brandSlug: 'samsung',
      }),
    });
    element.type(element.props);

    // Assert
    expect(mockLoadBrandAuthorityPage).toHaveBeenCalledWith(
      {
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        brandSlug: 'samsung',
      },
      { includeRequestPathPrefix: false }
    );
    expect(mockGetStorefrontPathPrefix).toHaveBeenCalledWith(
      'ogabassey',
      'ogabassey'
    );
    expect(mockBrandAuthorityPageContent).toHaveBeenCalledWith({
      page: { ...page, pathPrefix: '/ogabassey' },
    });
  });

  it('renders the not-found fallback with the resolved recovery link when the hub is thin', async () => {
    // Arrange
    mockLoadBrandAuthorityPage.mockResolvedValue(null);
    mockGetStorefrontPathPrefix.mockResolvedValue('/ogabassey');
    const { brandAuthorityPageRuntime } = await import(
      './brand-authority-page-runtime'
    );

    // Act
    const element = await brandAuthorityPageRuntime.render({
      params: Promise.resolve({
        slug: 'ogabassey',
        category: 'smartphones',
        brandSlug: 'samsung',
      }),
    });
    render(element);

    // Assert
    expect(mockGetStorefrontPathPrefix).toHaveBeenCalledWith(
      'ogabassey',
      'ogabassey'
    );
    expect(
      screen.getByRole('heading', { name: 'Brand hub not found' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('This brand hub is unavailable or has moved.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/ogabassey'
    );
  });
});
