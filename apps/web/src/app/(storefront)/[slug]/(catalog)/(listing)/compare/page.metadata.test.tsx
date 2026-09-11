import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM } from '@/config/storefront-metadata-cache-bots';
import {
  categories,
  generateMetadata,
  getCachedCategories,
  getCachedCategoryPageData,
  mockGenerateCategoryMetadata,
  resetCompareMetadataMocks,
} from './page.metadata.test-utils';

describe('compare index metadata', () => {
  beforeEach(() => {
    resetCompareMetadataMocks();
  });

  it('emits indexable canonical metadata for the compare index', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(metadata.title).toEqual({
      absolute: 'Compare products | Ogabassey',
    });
    expect(metadata.alternates).toMatchObject({
      canonical: 'https://ogabassey.com/compare',
    });
    expect(metadata.robots).toMatchObject({
      index: true,
      follow: true,
    });
  });

  it('keeps the compare index indexable for internal metadata cache bucket requests', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams: Promise.resolve({
        [STOREFRONT_METADATA_CACHE_BUCKET_QUERY_PARAM]: 'metadata-blocking',
      }),
    });

    expect(metadata.alternates).toMatchObject({
      canonical: 'https://ogabassey.com/compare',
    });
    expect(metadata.robots).toMatchObject({
      index: true,
      follow: true,
    });
  });

  it('delegates metadata to the category page when the merchant owns a compare category', async () => {
    vi.mocked(getCachedCategories).mockResolvedValueOnce([
      ...categories,
      {
        id: 'category-compare',
        name: 'Compare',
        slug: ' Compare ',
        description: null,
        image_url: null,
        is_active: true,
        parent_id: null,
      },
    ]);

    const searchParams = Promise.resolve({
      page: '2',
      sort: 'price-asc',
    });
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
      searchParams,
    });

    expect(metadata.title).toBe('Compare category metadata');
    expect(mockGenerateCategoryMetadata).toHaveBeenCalledTimes(1);
    const categoryProps = mockGenerateCategoryMetadata.mock.calls[0]?.[0];

    if (!categoryProps) {
      throw new Error('Expected category metadata props');
    }

    await expect(categoryProps.params).resolves.toEqual({
      slug: 'ogabassey',
      category: 'compare',
    });
    await expect(categoryProps.searchParams).resolves.toEqual({
      page: '2',
      sort: 'price-asc',
    });
    expect(getCachedCategoryPageData).not.toHaveBeenCalled();
  });

  it('uses the compare hub when the merchant compare category is inactive', async () => {
    vi.mocked(getCachedCategories).mockResolvedValueOnce([
      ...categories,
      {
        id: 'category-compare',
        name: 'Compare',
        slug: 'compare',
        description: null,
        image_url: null,
        is_active: false,
        parent_id: null,
      },
    ]);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(metadata.title).toEqual({
      absolute: 'Compare products | Ogabassey',
    });
    expect(mockGenerateCategoryMetadata).not.toHaveBeenCalled();
    expect(getCachedCategoryPageData).toHaveBeenCalled();
  });
});
