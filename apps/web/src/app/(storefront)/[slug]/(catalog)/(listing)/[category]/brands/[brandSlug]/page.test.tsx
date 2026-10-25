import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoad = vi.fn();
const mockGetStorefrontPathPrefix = vi.fn();

vi.mock('next/server', () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/seo-utils', () => ({
  getIndexableRobotsMetadata: () => ({ index: true, follow: true }),
}));

vi.mock('@/lib/storefront-category/load-brand-authority-page', () => ({
  brandAuthorityPageLoader: {
    load: (...args: unknown[]) => mockLoad(...args),
    getStorefrontPathPrefix: (...args: unknown[]) =>
      mockGetStorefrontPathPrefix(...args),
  },
}));

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

vi.mock('./brand-authority-page-content', () => ({
  BrandAuthorityPageContent: () => <div>Brand authority page content</div>,
}));

const pageModel = {
  canonicalUrl: 'https://ogabassey.com/smartphones/brands/samsung',
  metaTitle: 'Samsung Phones and Prices in Nigeria | Ogabassey',
  metaDescription: 'Compare active Samsung phones and prices.',
  merchant: { slug: 'ogabassey' },
};

describe('brand authority page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStorefrontPathPrefix.mockResolvedValue('');
  });

  it('publishes a self-canonical indexable metadata contract', async () => {
    mockLoad.mockResolvedValue(pageModel);
    const { generateMetadata } = await import('./page');
    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'ogabassey',
        category: 'smartphones',
        brandSlug: 'samsung',
      }),
    });

    expect(metadata).toMatchObject({
      title: { absolute: pageModel.metaTitle },
      alternates: { canonical: pageModel.canonicalUrl },
      robots: { index: true, follow: true },
    });
  });

  it('returns marker-free not-found metadata for a missing brand hub', async () => {
    mockLoad.mockResolvedValue(null);
    const { generateMetadata } = await import('./page');
    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'ogabassey',
        category: 'smartphones',
        brandSlug: 'unknown',
      }),
    });

    expect(metadata).toEqual({
      title: 'Brand Hub Not Found',
      description: 'This brand hub is unavailable.',
      robots: { index: false, follow: true },
      alternates: null,
      openGraph: undefined,
      twitter: undefined,
    });
  });

  it('returns marker-free not-found metadata for an unindexable brand hub', async () => {
    mockLoad.mockResolvedValue({ ...pageModel, isIndexable: false });
    const { generateMetadata } = await import('./page');
    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'ogabassey',
        category: 'smartphones',
        brandSlug: 'samsung',
      }),
    });

    expect(metadata).toEqual({
      title: 'Brand Hub Not Found',
      description: 'This brand hub is unavailable.',
      robots: { index: false, follow: true },
      alternates: null,
      openGraph: undefined,
      twitter: undefined,
    });
  });

  it('renders StorefrontRouteNotFoundContent when brand hub is missing without throwing', async () => {
    mockLoad.mockResolvedValue(null);
    mockGetStorefrontPathPrefix.mockResolvedValueOnce('/ogabassey');
    const { brandAuthorityPageRuntime } = await import(
      './brand-authority-page-runtime'
    );
    const ui = await brandAuthorityPageRuntime.render({
      params: Promise.resolve({
        slug: 'ogabassey',
        category: 'smartphones',
        brandSlug: 'unknown',
      }),
    });

    render(ui);
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

  it('renders StorefrontRouteNotFoundContent with root backHref on a merchant subdomain when brand hub is unindexable', async () => {
    mockLoad.mockResolvedValue({ ...pageModel, isIndexable: false });
    mockGetStorefrontPathPrefix.mockResolvedValueOnce('');
    const { brandAuthorityPageRuntime } = await import(
      './brand-authority-page-runtime'
    );
    const ui = await brandAuthorityPageRuntime.render({
      params: Promise.resolve({
        slug: 'shop',
        category: 'smartphones',
        brandSlug: 'samsung',
      }),
    });

    render(ui);
    expect(
      screen.getByRole('heading', { name: 'Brand hub not found' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/'
    );
  });

  it('rejects when the loader throws a database error', async () => {
    mockLoad.mockRejectedValue(new Error('Postgres connection failed'));
    const { generateMetadata } = await import('./page');
    const { brandAuthorityPageRuntime } = await import(
      './brand-authority-page-runtime'
    );

    const props = {
      params: Promise.resolve({
        slug: 'ogabassey',
        category: 'smartphones',
        brandSlug: 'samsung',
      }),
    };

    await expect(generateMetadata(props)).rejects.toThrow(
      'Postgres connection failed'
    );
    await expect(brandAuthorityPageRuntime.render(props)).rejects.toThrow(
      'Postgres connection failed'
    );
  });
});
