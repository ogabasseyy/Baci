import { describe, expect, it } from 'vitest';
import {
  getCanonicalStorefrontFilterSearchParams,
  getIndexableRobotsMetadata,
  hasFilterableQueryParams,
} from './storefront-filter-metadata-policy';

describe('storefront-filter-metadata-policy', () => {
  describe('hasFilterableQueryParams', () => {
    it('returns false when searchParams is undefined or empty', () => {
      expect(hasFilterableQueryParams()).toBe(false);
      expect(hasFilterableQueryParams({})).toBe(false);
    });

    it('returns false for unrecognized or empty query parameters', () => {
      expect(
        hasFilterableQueryParams({ page: '2', utm_source: 'google' })
      ).toBe(false);
      expect(hasFilterableQueryParams({ brand: '', search: '   ' })).toBe(
        false
      );
      expect(hasFilterableQueryParams({ brand: ['', '  '] })).toBe(false);
    });

    it('returns true when recognized filter parameters have values', () => {
      expect(hasFilterableQueryParams({ brand: 'Dell' })).toBe(true);
      expect(hasFilterableQueryParams({ color: ['Black'] })).toBe(true);
      expect(hasFilterableQueryParams({ minPrice: '50000' })).toBe(true);
    });

    it('detects sort, sortBy, order, and graphicsHub query parameters', () => {
      expect(hasFilterableQueryParams({ sort: 'price-asc' })).toBe(true);
      expect(hasFilterableQueryParams({ sortBy: 'price' })).toBe(true);
      expect(hasFilterableQueryParams({ order: 'desc' })).toBe(true);
      expect(hasFilterableQueryParams({ graphicsHub: 'rtx-4070' })).toBe(true);
    });
  });

  describe('getCanonicalStorefrontFilterSearchParams', () => {
    it('returns empty params when searchParams is undefined or empty', () => {
      expect(getCanonicalStorefrontFilterSearchParams().toString()).toBe('');
      expect(getCanonicalStorefrontFilterSearchParams({}).toString()).toBe('');
    });

    it('drops canonical filter params until filters affect listing results', () => {
      expect(
        getCanonicalStorefrontFilterSearchParams({ brand: 'Dell' }).toString()
      ).toBe('');
      expect(
        getCanonicalStorefrontFilterSearchParams(
          { brand: 'Dell' },
          { filtersAffectResults: false }
        ).toString()
      ).toBe('');
    });

    it('preserves a focused single listing filter in canonical query params', () => {
      expect(
        getCanonicalStorefrontFilterSearchParams(
          { brand: 'Dell' },
          { filtersAffectResults: true }
        ).toString()
      ).toBe('brand=Dell');

      expect(
        getCanonicalStorefrontFilterSearchParams(
          { color: 'Midnight Blue' },
          { filtersAffectResults: true }
        ).toString()
      ).toBe('color=Midnight+Blue');
    });

    it('keeps price range bounds together as one canonical listing filter', () => {
      expect(
        getCanonicalStorefrontFilterSearchParams(
          { minPrice: '100000', maxPrice: '500000' },
          { filtersAffectResults: true }
        ).toString()
      ).toBe('minPrice=100000&maxPrice=500000');

      expect(
        getCanonicalStorefrontFilterSearchParams(
          { minPrice: '100000' },
          { filtersAffectResults: true }
        ).toString()
      ).toBe('minPrice=100000');
    });

    it('normalizes search aliases to the canonical search query param', () => {
      expect(
        getCanonicalStorefrontFilterSearchParams(
          { q: 'iphone 16' },
          { filtersAffectResults: true }
        ).toString()
      ).toBe('search=iphone+16');

      expect(
        getCanonicalStorefrontFilterSearchParams(
          { query: 'pixel 10' },
          { filtersAffectResults: true }
        ).toString()
      ).toBe('search=pixel+10');

      expect(
        getCanonicalStorefrontFilterSearchParams(
          { search: 'redmi pad' },
          { filtersAffectResults: true }
        ).toString()
      ).toBe('search=redmi+pad');
    });

    it('preserves a focused graphics filter in canonical query params', () => {
      expect(
        getCanonicalStorefrontFilterSearchParams(
          { graphics: 'NVIDIA RTX 4070' },
          { filtersAffectResults: true }
        ).toString()
      ).toBe('graphics=NVIDIA+RTX+4070');
    });

    it('drops canonical filter params for multi-filter listing URLs', () => {
      expect(
        getCanonicalStorefrontFilterSearchParams(
          { brand: 'Dell', minPrice: '100000' },
          { filtersAffectResults: true }
        ).toString()
      ).toBe('');

      expect(
        getCanonicalStorefrontFilterSearchParams(
          { graphics: 'NVIDIA RTX 4070', graphicsHub: 'rtx-4070' },
          { filtersAffectResults: true }
        ).toString()
      ).toBe('');
    });

    it('handles array values and trims whitespace', () => {
      expect(
        getCanonicalStorefrontFilterSearchParams(
          { brand: ['  Apple  ', 'Dell', '   '] },
          { filtersAffectResults: true }
        ).toString()
      ).toBe('brand=Apple&brand=Dell');
    });
  });

  describe('getIndexableRobotsMetadata', () => {
    it('returns large-preview directives for indexable storefront pages without filters', () => {
      expect(getIndexableRobotsMetadata()).toEqual({
        index: true,
        follow: true,
        googleBot: {
          index: true,
          follow: true,
          'max-image-preview': 'large',
          'max-snippet': -1,
          'max-video-preview': -1,
        },
        'max-image-preview': 'large',
        'max-snippet': -1,
        'max-video-preview': -1,
      });

      expect(getIndexableRobotsMetadata({})).toEqual({
        index: true,
        follow: true,
        googleBot: {
          index: true,
          follow: true,
          'max-image-preview': 'large',
          'max-snippet': -1,
          'max-video-preview': -1,
        },
        'max-image-preview': 'large',
        'max-snippet': -1,
        'max-video-preview': -1,
      });
    });

    it('keeps focused single-filter listing URLs indexable when filters affect results', () => {
      expect(getIndexableRobotsMetadata({ brand: 'Dell' })).toMatchObject({
        index: false,
        follow: true,
        googleBot: {
          index: false,
          follow: true,
        },
      });

      expect(
        getIndexableRobotsMetadata(
          { brand: 'Dell' },
          { filtersAffectResults: true }
        )
      ).toMatchObject({
        index: true,
        follow: true,
        googleBot: {
          index: true,
          follow: true,
        },
      });
    });

    it('deduplicates legacy singular and plural keys for the same listing filter', () => {
      expect(
        getIndexableRobotsMetadata(
          { brand: 'Dell', brands: 'Dell' },
          { filtersAffectResults: true }
        )
      ).toMatchObject({
        index: true,
        follow: true,
        googleBot: {
          index: true,
          follow: true,
        },
      });
    });

    it('treats price bounds as one listing filter', () => {
      expect(
        getIndexableRobotsMetadata(
          { minPrice: '100000', maxPrice: '500000' },
          { filtersAffectResults: true }
        )
      ).toMatchObject({
        index: true,
        follow: true,
        googleBot: {
          index: true,
          follow: true,
        },
      });
    });

    it('treats graphics as a storefront filter for faceted listing URLs', () => {
      expect(
        getIndexableRobotsMetadata({ graphics: 'NVIDIA RTX 4070' })
      ).toMatchObject({
        index: false,
        follow: true,
      });

      expect(
        getIndexableRobotsMetadata(
          { graphics: 'NVIDIA RTX 4070' },
          { filtersAffectResults: true }
        )
      ).toMatchObject({
        index: true,
        follow: true,
      });
    });

    it('noindexes multi-filter listing URLs while preserving follow directives', () => {
      expect(
        getIndexableRobotsMetadata({
          brand: 'Dell',
          minPrice: '100000',
        })
      ).toMatchObject({
        index: false,
        follow: true,
        googleBot: {
          index: false,
          follow: true,
        },
      });

      expect(
        getIndexableRobotsMetadata(
          {
            brand: 'Dell',
            minPrice: '100000',
          },
          { filtersAffectResults: true }
        )
      ).toMatchObject({
        index: false,
        follow: true,
        googleBot: {
          index: false,
          follow: true,
        },
      });
    });

    it('noindexes hub transition token URLs and omits the token from canonical params', () => {
      expect(
        getIndexableRobotsMetadata({
          graphics: 'NVIDIA RTX 4070',
          graphicsHub: 'rtx-4070',
        })
      ).toMatchObject({
        index: false,
        follow: true,
      });

      expect(
        getIndexableRobotsMetadata(
          {
            graphics: 'NVIDIA RTX 4070',
            graphicsHub: 'rtx-4070',
          },
          { filtersAffectResults: true }
        )
      ).toMatchObject({
        index: false,
        follow: true,
      });
    });

    it('noindexes sort, sortBy, order, and graphicsHub listing URLs while preserving follow directives', () => {
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
          googleBot: {
            index: false,
            follow: true,
          },
        });
      }
    });

    it('noindexes storefront search query URLs while preserving follow directives', () => {
      expect(getIndexableRobotsMetadata({ q: 'acc6.top' })).toMatchObject({
        index: false,
        follow: true,
        googleBot: {
          index: false,
          follow: true,
        },
      });

      expect(getIndexableRobotsMetadata({ query: 'iphone 16' })).toMatchObject({
        index: false,
        follow: true,
        googleBot: {
          index: false,
          follow: true,
        },
      });

      expect(getIndexableRobotsMetadata({ search: 'pixel 10' })).toMatchObject({
        index: false,
        follow: true,
        googleBot: {
          index: false,
          follow: true,
        },
      });
    });
  });
});
