import { describe, expect, it } from 'vitest';
import { buildCatalogLinkModules } from './build-catalog-link-modules';

describe('buildCatalogLinkModules', () => {
  it('builds maintained compare and editorial modules, omitting category hubs and category pagination', () => {
    const modules = buildCatalogLinkModules({
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

  it('omits catalog-pages, catalog-categories, and category-pages modules', () => {
    const modules = buildCatalogLinkModules({
      compareLinks: [{ href: '/smartphones/compare/a-vs-b', label: 'A vs B' }],
      editorialLinks: [],
    });

    expect(modules.some((module) => module.id === 'catalog-pages')).toBe(false);
    expect(modules.some((module) => module.id === 'catalog-categories')).toBe(
      false
    );
    expect(modules.some((module) => module.id === 'category-pages')).toBe(
      false
    );
  });

  it('does not create direct PDP shortcut modules from product slugs', () => {
    const modules = buildCatalogLinkModules({
      compareLinks: [],
      editorialLinks: [],
    });

    expect(
      modules.some((module) => module.id.includes('product-shortcut'))
    ).toBe(false);
  });
});
