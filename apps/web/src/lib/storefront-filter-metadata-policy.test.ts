import { describe, expect, it } from 'vitest';
import {
  getCanonicalStorefrontFilterSearchParams,
  getIndexableRobotsMetadata,
  hasFilterableQueryParams,
  type StorefrontFilterMetadataOptions,
  type StorefrontRobotsSearchParams,
} from './storefront-filter-metadata-policy';

const ROBOTS_DEFAULT = {
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
};

function expectRobots(
  params?: StorefrontRobotsSearchParams,
  options?: StorefrontFilterMetadataOptions,
  expectedIndex = true
) {
  expect(getIndexableRobotsMetadata(params, options)).toMatchObject({
    index: expectedIndex,
    follow: true,
    googleBot: { index: expectedIndex, follow: true },
  });
}

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
      for (const params of [
        { sort: 'price-asc' },
        { sortBy: 'price' },
        { order: 'desc' },
        { graphicsHub: 'rtx-4070' },
      ]) {
        expect(hasFilterableQueryParams(params)).toBe(true);
      }
    });

    it('detects category and categories query parameters', () => {
      for (const params of [
        { category: 'Smartphones' },
        { categories: 'Smartphones' },
      ]) {
        expect(hasFilterableQueryParams(params)).toBe(true);
      }
    });
  });

  describe('getCanonicalStorefrontFilterSearchParams', () => {
    const toCanonical = (
      params?: StorefrontRobotsSearchParams,
      options: StorefrontFilterMetadataOptions = { filtersAffectResults: true }
    ) => getCanonicalStorefrontFilterSearchParams(params, options).toString();

    it('returns empty params when searchParams is undefined or empty', () => {
      expect(getCanonicalStorefrontFilterSearchParams().toString()).toBe('');
      expect(getCanonicalStorefrontFilterSearchParams({}).toString()).toBe('');
    });

    it('drops canonical filter params until filters affect listing results', () => {
      expect(toCanonical({ brand: 'Dell' }, {})).toBe('');
      expect(
        toCanonical({ brand: 'Dell' }, { filtersAffectResults: false })
      ).toBe('');
    });

    it('preserves a focused single listing filter in canonical query params', () => {
      expect(toCanonical({ brand: 'Dell' })).toBe('brand=Dell');
      expect(toCanonical({ color: 'Midnight Blue' })).toBe(
        'color=Midnight+Blue'
      );
      expect(toCanonical({ graphics: 'NVIDIA RTX 4070' })).toBe(
        'graphics=NVIDIA+RTX+4070'
      );
    });

    it('keeps price range bounds together as one canonical listing filter', () => {
      expect(toCanonical({ minPrice: '100000', maxPrice: '500000' })).toBe(
        'minPrice=100000&maxPrice=500000'
      );
      expect(toCanonical({ minPrice: '100000' })).toBe('minPrice=100000');
    });

    it('normalizes search aliases to the canonical search query param', () => {
      expect(toCanonical({ q: 'iphone 16' })).toBe('search=iphone+16');
      expect(toCanonical({ query: 'pixel 10' })).toBe('search=pixel+10');
      expect(toCanonical({ search: 'redmi pad' })).toBe('search=redmi+pad');
    });

    it('preserves a focused graphics filter in canonical query params', () => {
      expect(toCanonical({ graphics: 'NVIDIA RTX 4070' })).toBe(
        'graphics=NVIDIA+RTX+4070'
      );
    });

    it('drops canonical filter params for multi-filter listing URLs', () => {
      expect(toCanonical({ brand: 'Dell', minPrice: '100000' })).toBe('');
      expect(
        toCanonical({ graphics: 'NVIDIA RTX 4070', graphicsHub: 'rtx-4070' })
      ).toBe('');
    });

    it('drops category and categories query parameters from canonical search params', () => {
      expect(toCanonical({ category: 'Smartphones' })).toBe('');
      expect(toCanonical({ categories: 'Smartphones' })).toBe('');
    });

    it('handles array values and trims whitespace', () => {
      expect(toCanonical({ brand: ['  Apple  ', 'Dell', '   '] })).toBe(
        'brand=Apple&brand=Dell'
      );
    });
  });

  describe('getIndexableRobotsMetadata', () => {
    it('returns large-preview directives for indexable storefront pages without filters', () => {
      expect(getIndexableRobotsMetadata()).toEqual(ROBOTS_DEFAULT);
      expect(getIndexableRobotsMetadata({})).toEqual(ROBOTS_DEFAULT);
    });

    it('keeps focused single-filter listing URLs indexable when filters affect results', () => {
      expectRobots({ brand: 'Dell' }, undefined, false);
      expectRobots({ brand: 'Dell' }, { filtersAffectResults: true }, true);
    });

    it('deduplicates legacy singular and plural keys for the same listing filter', () => {
      expectRobots(
        { brand: 'Dell', brands: 'Dell' },
        { filtersAffectResults: true },
        true
      );
    });

    it('treats price bounds as one listing filter', () => {
      expectRobots(
        { minPrice: '100000', maxPrice: '500000' },
        { filtersAffectResults: true },
        true
      );
    });

    it('treats graphics as a storefront filter for faceted listing URLs', () => {
      expectRobots({ graphics: 'NVIDIA RTX 4070' }, undefined, false);
      expectRobots(
        { graphics: 'NVIDIA RTX 4070' },
        { filtersAffectResults: true },
        true
      );
    });

    it('noindexes multi-filter listing URLs while preserving follow directives', () => {
      expectRobots({ brand: 'Dell', minPrice: '100000' }, undefined, false);
      expectRobots(
        { brand: 'Dell', minPrice: '100000' },
        { filtersAffectResults: true },
        false
      );
    });

    it('noindexes hub transition token URLs and omits the token from canonical params', () => {
      expectRobots(
        { graphics: 'NVIDIA RTX 4070', graphicsHub: 'rtx-4070' },
        undefined,
        false
      );
      expectRobots(
        { graphics: 'NVIDIA RTX 4070', graphicsHub: 'rtx-4070' },
        { filtersAffectResults: true },
        false
      );
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
        expectRobots(searchParams, undefined, false);
        expectRobots(searchParams, { filtersAffectResults: true }, false);
      }
    });

    it('noindexes category and categories listing URLs while preserving follow directives', () => {
      for (const searchParams of [
        { category: 'Smartphones' },
        { categories: 'Smartphones' },
      ]) {
        expect(hasFilterableQueryParams(searchParams)).toBe(true);
        expectRobots(searchParams, undefined, false);
        expectRobots(searchParams, { filtersAffectResults: true }, false);
      }
    });

    it('noindexes storefront search query URLs unless filtersAffectResults is true', () => {
      for (const searchParams of [
        { q: 'acc6.top' },
        { query: 'iphone 16' },
        { search: 'pixel 10' },
      ]) {
        expectRobots(searchParams, undefined, false);
        expectRobots(searchParams, { filtersAffectResults: true }, true);
      }
    });
  });
});
