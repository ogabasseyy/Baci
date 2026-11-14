import { describe, expect, it } from 'vitest';
import {
  getCanonicalStorefrontFilterSearchParams,
  getIndexableRobotsMetadata,
  hasFilterableQueryParams,
} from './seo-utils';

describe('seo-utils crawl-policy re-exports', () => {
  it('detects filterable query parameters including sort and graphicsHub', () => {
    expect(hasFilterableQueryParams()).toBe(false);
    expect(hasFilterableQueryParams({ brand: 'Dell' })).toBe(true);
    expect(hasFilterableQueryParams({ sort: 'price-asc' })).toBe(true);
    expect(hasFilterableQueryParams({ graphicsHub: 'rtx-4070' })).toBe(true);
  });

  it('drops canonical filter params until filters affect results', () => {
    expect(
      getCanonicalStorefrontFilterSearchParams({ brand: 'Dell' }).toString()
    ).toBe('');
    expect(
      getCanonicalStorefrontFilterSearchParams(
        { brand: 'Dell' },
        { filtersAffectResults: true }
      ).toString()
    ).toBe('brand=Dell');
  });

  it('omits graphicsHub token from canonical params and treats it as filter', () => {
    expect(
      getCanonicalStorefrontFilterSearchParams(
        { graphics: 'NVIDIA RTX 4070', graphicsHub: 'rtx-4070' },
        { filtersAffectResults: true }
      ).toString()
    ).toBe('');
  });

  it('noindexes sort, sortBy, order, and graphicsHub URLs', () => {
    for (const searchParams of [
      { sort: 'price-asc' },
      { sort: 'newest' },
      { sortBy: 'price' },
      { order: 'desc' },
      { graphicsHub: 'rtx-4070' },
    ]) {
      expect(hasFilterableQueryParams(searchParams)).toBe(true);
      expect(getIndexableRobotsMetadata(searchParams)).toMatchObject({
        index: false,
        follow: true,
        googleBot: { index: false, follow: true },
      });
      expect(
        getIndexableRobotsMetadata(searchParams, { filtersAffectResults: true })
      ).toMatchObject({
        index: false,
        follow: true,
        googleBot: { index: false, follow: true },
      });
    }
  });

  it('keeps single facet indexable when filters affect results and noindexes multi-filter', () => {
    expect(
      getIndexableRobotsMetadata(
        { brand: 'Dell' },
        { filtersAffectResults: true }
      )
    ).toMatchObject({
      index: true,
      follow: true,
    });

    expect(
      getIndexableRobotsMetadata(
        { brand: 'Dell', minPrice: '100000' },
        { filtersAffectResults: true }
      )
    ).toMatchObject({
      index: false,
      follow: true,
    });
  });
});
