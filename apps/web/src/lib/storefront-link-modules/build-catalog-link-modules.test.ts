import { describe, expect, it } from 'vitest';
import { buildCatalogLinkModules } from './build-catalog-link-modules';

describe('buildCatalogLinkModules', () => {
  it('builds maintained category, pagination, compare, and editorial modules', () => {
    const modules = buildCatalogLinkModules({
      productBasePath: '/products',
      productTotalPages: 6,
      categories: [
        { slug: 'smartphones', name: 'Smartphones', totalPages: 9 },
        { slug: 'laptops', name: 'Laptops', totalPages: 4 },
      ],
      compareLinks: [
        {
          href: '/smartphones/compare/iphone-12-vs-xiaomi-13t',
          label: 'iPhone 12 vs Xiaomi 13T',
        },
      ],
      editorialLinks: [
        {
          href: '/blog/iphone/the-iphone-15-what-we-know-so-far',
          label: 'iPhone 15 buying guide',
        },
      ],
    });

    expect(modules).toEqual([
      {
        id: 'catalog-categories',
        title: 'Shop by category',
        description: 'Browse maintained Ogabassey category hubs.',
        items: [
          { href: '/smartphones', label: 'Smartphones', source: 'category' },
          { href: '/laptops', label: 'Laptops', source: 'category' },
        ],
      },
      {
        id: 'catalog-pages',
        title: 'Browse product pages',
        description: 'Jump through the maintained product index.',
        items: [
          {
            href: '/products?page=2',
            label: 'Products page 2',
            source: 'catalog-pagination',
          },
          {
            href: '/products?page=3',
            label: 'Products page 3',
            source: 'catalog-pagination',
          },
          {
            href: '/products?page=4',
            label: 'Products page 4',
            source: 'catalog-pagination',
          },
          {
            href: '/products?page=5',
            label: 'Products page 5',
            source: 'catalog-pagination',
          },
          {
            href: '/products?page=6',
            label: 'Products page 6',
            source: 'catalog-pagination',
          },
        ],
      },
      {
        id: 'category-pages',
        title: 'Browse category pages',
        description: 'Jump to maintained category listing pages.',
        items: [
          {
            href: '/smartphones?page=2',
            label: 'Smartphones page 2',
            source: 'catalog-pagination',
          },
          {
            href: '/smartphones?page=3',
            label: 'Smartphones page 3',
            source: 'catalog-pagination',
          },
          {
            href: '/smartphones?page=4',
            label: 'Smartphones page 4',
            source: 'catalog-pagination',
          },
          {
            href: '/smartphones?page=5',
            label: 'Smartphones page 5',
            source: 'catalog-pagination',
          },
          {
            href: '/smartphones?page=6',
            label: 'Smartphones page 6',
            source: 'catalog-pagination',
          },
          {
            href: '/smartphones?page=7',
            label: 'Smartphones page 7',
            source: 'catalog-pagination',
          },
          {
            href: '/smartphones?page=8',
            label: 'Smartphones page 8',
            source: 'catalog-pagination',
          },
          {
            href: '/smartphones?page=9',
            label: 'Smartphones page 9',
            source: 'catalog-pagination',
          },
          {
            href: '/laptops?page=2',
            label: 'Laptops page 2',
            source: 'catalog-pagination',
          },
          {
            href: '/laptops?page=3',
            label: 'Laptops page 3',
            source: 'catalog-pagination',
          },
          {
            href: '/laptops?page=4',
            label: 'Laptops page 4',
            source: 'catalog-pagination',
          },
        ],
      },
      {
        id: 'compare-modules',
        title: 'Compare products',
        description:
          'Use maintained comparison pages for common buying decisions.',
        items: [
          {
            href: '/smartphones/compare/iphone-12-vs-xiaomi-13t',
            label: 'iPhone 12 vs Xiaomi 13T',
            source: 'compare',
          },
        ],
      },
      {
        id: 'editorial-guides',
        title: 'Buying guides',
        description: 'Read maintained guides that support product research.',
        items: [
          {
            href: '/blog/iphone/the-iphone-15-what-we-know-so-far',
            label: 'iPhone 15 buying guide',
            source: 'editorial',
          },
        ],
      },
    ]);
  });

  it('does not create direct PDP shortcut modules from product slugs', () => {
    const modules = buildCatalogLinkModules({
      productBasePath: '/products',
      productTotalPages: 1,
      categories: [],
      compareLinks: [],
      editorialLinks: [],
    });

    expect(
      modules.some((module) => module.id.includes('product-shortcut'))
    ).toBe(false);
  });
});
