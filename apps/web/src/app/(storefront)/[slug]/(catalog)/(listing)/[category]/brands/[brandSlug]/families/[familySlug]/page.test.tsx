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

vi.mock('@/lib/storefront-category/load-model-family-authority-page', () => ({
  modelFamilyAuthorityPageLoader: {
    load: (...args: unknown[]) => mockLoad(...args),
  },
}));

vi.mock('@/lib/storefront-category/load-brand-authority-page', () => ({
  brandAuthorityPageLoader: {
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

vi.mock('../../brand-authority-page-content', () => ({
  BrandAuthorityPageContent: () => <div>Brand authority page content</div>,
}));

const familyPageModel = {
  canonicalUrl:
    'https://store.test/smartphones/brands/samsung/families/galaxy-s',
  metaTitle: 'Samsung Galaxy S Phones and Prices in Nigeria | Store',
  metaDescription: 'Compare Galaxy S phones.',
  merchant: { slug: 'store' },
};

describe('model family authority page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStorefrontPathPrefix.mockResolvedValue('');
  });

  it('uses indexable canonical metadata from the loader', async () => {
    mockLoad.mockResolvedValue(familyPageModel);
    const { generateMetadata } = await import('./page');
    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'store',
        category: 'smartphones',
        brandSlug: 'samsung',
        familySlug: 'galaxy-s',
      }),
    });
    expect(metadata).toMatchObject({
      title: {
        absolute: 'Samsung Galaxy S Phones and Prices in Nigeria | Store',
      },
      alternates: {
        canonical:
          'https://store.test/smartphones/brands/samsung/families/galaxy-s',
      },
      robots: { index: true, follow: true },
    });
  });

  it('returns marker-free not-found metadata for a missing model family hub', async () => {
    mockLoad.mockResolvedValue(null);
    const { generateMetadata } = await import('./page');
    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'store',
        category: 'smartphones',
        brandSlug: 'samsung',
        familySlug: 'unknown',
      }),
    });

    expect(metadata).toEqual({
      title: 'Model Family Hub Not Found',
      description: 'This model family hub is unavailable.',
      robots: { index: false, follow: true },
      alternates: null,
      openGraph: undefined,
      twitter: undefined,
    });
  });

  it('returns marker-free not-found metadata for an unindexable model family hub', async () => {
    mockLoad.mockResolvedValue({ ...familyPageModel, isIndexable: false });
    const { generateMetadata } = await import('./page');
    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'store',
        category: 'smartphones',
        brandSlug: 'samsung',
        familySlug: 'galaxy-s',
      }),
    });

    expect(metadata).toEqual({
      title: 'Model Family Hub Not Found',
      description: 'This model family hub is unavailable.',
      robots: { index: false, follow: true },
      alternates: null,
      openGraph: undefined,
      twitter: undefined,
    });
  });

  it('renders StorefrontRouteNotFoundContent when model family hub is missing without throwing', async () => {
    mockLoad.mockResolvedValue(null);
    mockGetStorefrontPathPrefix.mockResolvedValueOnce('/store');
    const { modelFamilyPageRuntime } = await import(
      './model-family-page-runtime'
    );
    const ui = await modelFamilyPageRuntime.render({
      params: Promise.resolve({
        slug: 'store',
        category: 'smartphones',
        brandSlug: 'samsung',
        familySlug: 'unknown',
      }),
    });

    render(ui);
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

  it('renders StorefrontRouteNotFoundContent with root backHref on a merchant subdomain when model family hub is unindexable', async () => {
    mockLoad.mockResolvedValue({ ...familyPageModel, isIndexable: false });
    mockGetStorefrontPathPrefix.mockResolvedValueOnce('');
    const { modelFamilyPageRuntime } = await import(
      './model-family-page-runtime'
    );
    const ui = await modelFamilyPageRuntime.render({
      params: Promise.resolve({
        slug: 'shop',
        category: 'smartphones',
        brandSlug: 'samsung',
        familySlug: 'galaxy-s',
      }),
    });

    render(ui);
    expect(
      screen.getByRole('heading', { name: 'Model family hub not found' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/'
    );
  });

  it('rejects when the loader throws a database error', async () => {
    mockLoad.mockRejectedValue(new Error('Postgres connection failed'));
    const { generateMetadata } = await import('./page');
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

    await expect(generateMetadata(props)).rejects.toThrow(
      'Postgres connection failed'
    );
    await expect(modelFamilyPageRuntime.render(props)).rejects.toThrow(
      'Postgres connection failed'
    );
  });
});
