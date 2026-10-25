import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoad = vi.fn();
const mockGetPathPrefix = vi.fn();
const mockContent = vi.fn();
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
vi.mock('@/lib/storefront-category/load-model-family-authority-page', () => ({
  modelFamilyAuthorityPageLoader: {
    load: (...args: unknown[]) => mockLoad(...args),
  },
}));
vi.mock('@/lib/storefront-category/load-brand-authority-page', () => ({
  brandAuthorityPageLoader: {
    getStorefrontPathPrefix: (...args: unknown[]) => mockGetPathPrefix(...args),
  },
}));
vi.mock('../../brand-authority-page-content', () => ({
  BrandAuthorityPageContent: (props: unknown) => {
    mockContent(props);
    return <div>family page</div>;
  },
}));
vi.mock('next/server', () => ({ connection: vi.fn() }));

describe('model family page runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoad.mockResolvedValue({
      merchant: { slug: 'store' },
      heading: 'Galaxy S',
    });
    mockGetPathPrefix.mockResolvedValue('');
  });

  it('loads and renders the curated family', async () => {
    const { modelFamilyPageRuntime } = await import(
      './model-family-page-runtime'
    );
    const props = {
      params: Promise.resolve({
        slug: 'store',
        category: 'smartphones',
        brandSlug: 'samsung',
        familySlug: 'galaxy-s',
      }),
    };
    render(await modelFamilyPageRuntime.render(props));
    expect(screen.getByText('family page')).toBeInTheDocument();
    expect(mockLoad).toHaveBeenCalledWith({
      merchantSlug: 'store',
      categorySlug: 'smartphones',
      brandSlug: 'samsung',
      familySlug: 'galaxy-s',
    });
    expect(mockContent).toHaveBeenCalledWith(
      expect.objectContaining({
        page: expect.objectContaining({ pathPrefix: '' }),
      })
    );
  });

  it('renders the not-found fallback with the resolved recovery link when the family no longer qualifies', async () => {
    mockLoad.mockResolvedValue(null);
    mockGetPathPrefix.mockResolvedValue('/store');
    const { modelFamilyPageRuntime } = await import(
      './model-family-page-runtime'
    );

    render(
      await modelFamilyPageRuntime.render({
        params: Promise.resolve({
          slug: 'store',
          category: 'smartphones',
          brandSlug: 'samsung',
          familySlug: 'galaxy-z',
        }),
      })
    );

    expect(mockGetPathPrefix).toHaveBeenCalledWith('store', 'store');
    expect(
      screen.getByRole('heading', { name: 'Model family hub not found' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('This model family hub is unavailable or has moved.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/store'
    );
  });
});
