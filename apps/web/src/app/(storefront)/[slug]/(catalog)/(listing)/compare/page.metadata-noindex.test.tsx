import { beforeEach, describe, expect, it } from 'vitest';
import {
  categoryPageData,
  generateMetadata,
  getCachedCategories,
  getCachedCategoryPageData,
  getRequestScopedMerchant,
  mockNotFound,
  resetCompareMetadataMocks,
} from './page.metadata.test-utils';

describe('compare index metadata noindex', () => {
  beforeEach(() => {
    resetCompareMetadataMocks();
  });

  it('returns noindex metadata for parameterized compare hub URLs', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({
        brand: 'Apple',
        search: 'iphone',
      }),
    });

    expect(metadata.alternates).toMatchObject({
      canonical: 'https://ogabassey.com/compare',
    });
    expect(metadata.robots).toMatchObject({
      index: false,
      follow: true,
    });
  });

  it('returns noindex metadata when the compare index has no eligible sections', async () => {
    vi.mocked(getCachedCategoryPageData).mockResolvedValueOnce({
      ...categoryPageData,
      products: [],
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(metadata.alternates).toMatchObject({
      canonical: 'https://ogabassey.com/compare',
    });
    expect(metadata.robots).toMatchObject({
      index: false,
      follow: true,
    });
  });

  it('returns noindex metadata when optional category navigation is unavailable', async () => {
    vi.mocked(getCachedCategories).mockRejectedValueOnce(
      new Error('category timeout')
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(metadata.alternates).toMatchObject({
      canonical: 'https://ogabassey.com/compare',
    });
    expect(metadata.robots).toMatchObject({
      index: false,
      follow: true,
    });
  });

  it('returns noindex metadata when the storefront merchant is missing', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValueOnce(null);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'missing-storefront' }),
    });

    expect(metadata.title).toBe('Compare products page not found');
    expect(metadata.alternates).toBeNull();
    expect(metadata.robots).toMatchObject({
      index: false,
      follow: true,
    });
  });

  it('calls notFound for invalid storefront identifiers', async () => {
    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: 'images' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });
});
