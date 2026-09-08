import { describe, expect, it } from 'vitest';
import {
  buildCanonicalCompareCategories,
  buildCompareIndexDescription,
  normalizeCompareProduct,
  sortCompareSections,
  toRequestRelativeHref,
} from './compare-page-content-helpers';

describe('compare page content helpers', () => {
  it('builds compare hub intro copy with a merchant name or generic fallback', () => {
    expect(buildCompareIndexDescription('Ogabassey')).toBe(
      'Browse Ogabassey product comparison pages by category and open side-by-side guides for eligible products.'
    );
    expect(buildCompareIndexDescription(null)).toBe(
      'Browse this store product comparison pages by category and open side-by-side guides for eligible products.'
    );
  });

  it('keeps platform paths scoped to the merchant slug without double-prefixing development URLs', () => {
    expect(
      toRequestRelativeHref(
        'https://ogabassey.usebaci.com/laptops/compare/a-vs-b',
        'https://ogabassey.usebaci.com',
        '/ogabassey'
      )
    ).toBe('/ogabassey/laptops/compare/a-vs-b');
    expect(
      toRequestRelativeHref(
        'http://localhost:3000/ogabassey/laptops/compare/a-vs-b',
        'http://localhost:3000/ogabassey',
        '/ogabassey'
      )
    ).toBe('/ogabassey/laptops/compare/a-vs-b');
  });

  it('normalizes protocol-relative hrefs as storefront paths', () => {
    expect(
      toRequestRelativeHref(
        '//evil.com/laptops/compare/a-vs-b',
        'https://ogabassey.usebaci.com',
        '/ogabassey'
      )
    ).toBe('/ogabassey/evil.com/laptops/compare/a-vs-b');
  });

  it('keeps malformed and cross-origin compare URLs unchanged', () => {
    expect(
      toRequestRelativeHref(
        'https://%',
        'https://ogabassey.usebaci.com',
        '/ogabassey'
      )
    ).toBe('https://%');
    expect(
      toRequestRelativeHref(
        'https://example.com/laptops/compare/a-vs-b',
        'https://ogabassey.usebaci.com',
        '/ogabassey'
      )
    ).toBe('https://example.com/laptops/compare/a-vs-b');
  });

  it('dedupes categories by canonical slug', () => {
    expect(
      buildCanonicalCompareCategories([
        { name: 'Laptops', slug: ' Laptops ' },
        { name: 'Laptop duplicates', slug: 'laptops' },
        { name: 'Audio', slug: 'audio' },
        { name: 'Invalid', slug: '' },
      ])
    ).toEqual([
      { name: 'Laptop duplicates', slug: 'laptops', categorySlug: 'laptops' },
      { name: 'Audio', slug: 'audio', categorySlug: 'audio' },
    ]);
  });

  it('preserves the normalized product category slug for parent category scans', () => {
    expect(
      normalizeCompareProduct(
        {
          id: 'product-1',
          name: 'Child Category Phone',
          slug: 'child-category-phone',
          brand: 'Example',
          categories: {
            id: 'child-category',
            name: 'Android Phones',
            slug: 'android-phones',
          },
          category: 'Android Phones',
          price: 100_000,
          product_key_specs: { ram_gb: 8 },
        },
        'smartphones'
      )
    ).toEqual(
      expect.objectContaining({
        category_slug: 'android-phones',
        slug: 'child-category-phone',
      })
    );
  });

  it('preserves category slugs joined through product_categories', () => {
    expect(
      normalizeCompareProduct(
        {
          id: 'product-2',
          name: 'Joined Category Phone',
          slug: 'joined-category-phone',
          brand: 'Example',
          category: 'Phones',
          price: 120_000,
          product_categories: [
            {
              categories: {
                id: 'joined-category',
                name: 'Android Phones',
                slug: 'android-phones',
              },
            },
          ],
          product_key_specs: { ram_gb: 8 },
        },
        'smartphones'
      )
    ).toEqual(
      expect.objectContaining({
        category_slug: 'android-phones',
        slug: 'joined-category-phone',
      })
    );
  });

  it('falls back to the scanned category when no joined category slug exists', () => {
    expect(
      normalizeCompareProduct(
        {
          id: 'product-3',
          name: 'Fallback Category Phone',
          slug: 'fallback-category-phone',
          brand: 'Example',
          category: '',
          price: 130_000,
          product_key_specs: { ram_gb: 8 },
        },
        'smartphones'
      )
    ).toEqual(
      expect.objectContaining({
        category_slug: 'smartphones',
        slug: 'fallback-category-phone',
      })
    );
  });

  it('sorts compare sections by link count before label', () => {
    expect(
      [
        {
          categoryName: 'Audio',
          categorySlug: 'audio',
          links: [{ href: '/a', label: 'A' }],
        },
        {
          categoryName: 'Laptops',
          categorySlug: 'laptops',
          links: [
            { href: '/b', label: 'B' },
            { href: '/c', label: 'C' },
          ],
        },
        {
          categoryName: 'Accessories',
          categorySlug: 'accessories',
          links: [{ href: '/d', label: 'D' }],
        },
      ].sort(sortCompareSections)
    ).toEqual([
      {
        categoryName: 'Laptops',
        categorySlug: 'laptops',
        links: [
          { href: '/b', label: 'B' },
          { href: '/c', label: 'C' },
        ],
      },
      {
        categoryName: 'Accessories',
        categorySlug: 'accessories',
        links: [{ href: '/d', label: 'D' }],
      },
      {
        categoryName: 'Audio',
        categorySlug: 'audio',
        links: [{ href: '/a', label: 'A' }],
      },
    ]);
  });
});
