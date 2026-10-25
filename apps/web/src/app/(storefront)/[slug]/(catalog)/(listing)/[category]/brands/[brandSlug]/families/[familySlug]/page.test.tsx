import { describe, expect, it, vi } from 'vitest';

const mockLoadIndexablePage = vi.fn();
const mockRender = vi.fn();
vi.mock('./model-family-page-runtime', () => ({
  modelFamilyPageRuntime: {
    loadIndexablePage: (...args: unknown[]) => mockLoadIndexablePage(...args),
    render: (...args: unknown[]) => mockRender(...args),
  },
}));

describe('model family authority page', () => {
  it('uses indexable canonical metadata from the loader', async () => {
    mockLoadIndexablePage.mockResolvedValue({
      page: {
        metaTitle: 'Samsung Galaxy S Phones and Prices in Nigeria | Store',
        metaDescription: 'Compare Galaxy S phones.',
        canonicalUrl:
          'https://store.test/smartphones/brands/samsung/families/galaxy-s',
      },
    });
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
    });
  });
});
