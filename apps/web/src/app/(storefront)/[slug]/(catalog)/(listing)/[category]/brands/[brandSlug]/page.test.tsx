import { describe, expect, it, vi } from 'vitest';

const mockLoadBrandAuthorityPage = vi.fn();
const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('@/lib/seo-utils', () => ({
  getIndexableRobotsMetadata: () => ({ index: true, follow: true }),
}));
vi.mock('./brand-authority-page-runtime', () => ({
  brandAuthorityPageRuntime: {
    loadIndexablePage: async (...args: unknown[]) => {
      const page = await mockLoadBrandAuthorityPage(...args);
      if (!page) {
        mockNotFound();
      }
      return { page, resolvedParams: {} };
    },
    render: vi.fn(),
  },
}));

const pageModel = {
  canonicalUrl: 'https://ogabassey.com/smartphones/brands/samsung',
  metaTitle: 'Samsung Phones and Prices in Nigeria | Ogabassey',
  metaDescription: 'Compare active Samsung phones and prices.',
  merchant: { slug: 'ogabassey' },
};

describe('brand authority page metadata', () => {
  it('publishes a self-canonical indexable metadata contract', async () => {
    mockLoadBrandAuthorityPage.mockResolvedValue(pageModel);
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

  it('returns not found when the loader rejects a thin hub', async () => {
    mockLoadBrandAuthorityPage.mockResolvedValue(null);
    const { generateMetadata } = await import('./page');

    await expect(
      generateMetadata({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          brandSlug: 'unknown',
        }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
