import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetStorefrontPathPrefix = vi.fn();
const mockLoadBrandAuthorityPage = vi.fn();
const mockBrandAuthorityPageContent = vi.fn();

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next/server', () => ({ connection: () => Promise.resolve() }));
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

  it('returns not found before resolving a path prefix when the hub is thin', async () => {
    // Arrange
    mockLoadBrandAuthorityPage.mockResolvedValue(null);
    const { brandAuthorityPageRuntime } = await import(
      './brand-authority-page-runtime'
    );

    // Act and assert
    await expect(
      brandAuthorityPageRuntime.render({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          brandSlug: 'samsung',
        }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockGetStorefrontPathPrefix).not.toHaveBeenCalled();
  });
});
