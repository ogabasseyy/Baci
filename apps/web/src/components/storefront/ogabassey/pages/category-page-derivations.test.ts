import type { SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FilterState } from '../components/CategoryFiltersSidebar';
import type { Product } from '../types';
import {
  buildAvailableFilterOptions,
  buildCategoryDisplayTitle,
  createCategoryAddToCartHandler,
  EMPTY_AVAILABLE_FILTER_OPTIONS,
  filterCategoryProducts,
  getCategoryProductColorName,
  hasActiveFilterSelection,
  INITIAL_CATEGORY_FILTER_STATE,
  shouldRouteGraphicsChangeThroughServer,
} from './category-page-derivations';

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: '1',
    name: 'Product',
    slug: 'product',
    description: '',
    price: '₦100',
    rawPrice: 100,
    image: '',
    condition: 'New',
    ...overrides,
  } as Product;
}

function buildFilters(overrides: Partial<FilterState> = {}): FilterState {
  return { ...INITIAL_CATEGORY_FILTER_STATE, ...overrides };
}

describe('getCategoryProductColorName', () => {
  it('returns the string directly for a string color', () => {
    expect(getCategoryProductColorName('Space Black')).toBe('Space Black');
  });

  it('returns the name field for an object color', () => {
    expect(getCategoryProductColorName({ name: 'Titanium' })).toBe('Titanium');
  });

  it('returns null when the object color has no name', () => {
    expect(getCategoryProductColorName({ name: null })).toBeNull();
  });
});

describe('buildAvailableFilterOptions', () => {
  it('returns empty options when client filters are disabled', () => {
    const products = [buildProduct({ brand: 'Apple' })];

    expect(buildAvailableFilterOptions(products, false)).toBe(
      EMPTY_AVAILABLE_FILTER_OPTIONS
    );
  });

  it('collects distinct sorted facet values from the products', () => {
    const products = [
      buildProduct({
        brand: 'Samsung',
        graphics: 'NVIDIA RTX 4070',
        ram: '8GB',
        storage: ['128GB', '256GB'],
        colors: ['Black'],
      }),
      buildProduct({
        id: '2',
        brand: 'Apple',
        graphics: 'Integrated Graphics',
        ram: '8GB',
        storage: '512GB',
        colors: [{ name: 'Blue', value: '#0000ff' }],
      }),
    ];

    const options = buildAvailableFilterOptions(products, true);

    expect(options.brand).toEqual(['Apple', 'Samsung']);
    expect(options.ram).toEqual(['8GB']);
    expect(options.storage).toEqual(['128GB', '256GB', '512GB']);
    expect(options.graphics).toEqual([
      'Integrated Graphics',
      'NVIDIA RTX 4070',
    ]);
    expect(options.colors).toEqual(['Black', 'Blue']);
  });
});

describe('filterCategoryProducts', () => {
  it('returns products unchanged when client filters are disabled', () => {
    const products = [buildProduct(), buildProduct({ id: '2' })];

    expect(filterCategoryProducts(products, buildFilters(), false)).toBe(
      products
    );
  });

  it('keeps only products matching an active brand facet', () => {
    const products = [
      buildProduct({ id: 'a', brand: 'Apple' }),
      buildProduct({ id: 's', brand: 'Samsung' }),
    ];

    const result = filterCategoryProducts(
      products,
      buildFilters({ brand: ['Apple'] }),
      true
    );

    expect(result.map((p) => p.id)).toEqual(['a']);
  });

  it('excludes products priced outside the min/max range', () => {
    const products = [
      buildProduct({ id: 'cheap', rawPrice: 50 }),
      buildProduct({ id: 'mid', rawPrice: 500 }),
    ];

    const result = filterCategoryProducts(
      products,
      buildFilters({ minPrice: 100, maxPrice: 1000 }),
      true
    );

    expect(result.map((p) => p.id)).toEqual(['mid']);
  });

  it('does not impose a maximum price until the shopper enters one', () => {
    const products = [buildProduct({ rawPrice: 25_000_000 })];

    expect(filterCategoryProducts(products, buildFilters(), true)).toEqual(
      products
    );
  });

  it('keeps only products matching an active graphics facet', () => {
    const products = [
      buildProduct({ id: 'rtx', graphics: 'NVIDIA RTX 4070' }),
      buildProduct({ id: 'integrated', graphics: 'Integrated Graphics' }),
    ];

    const result = filterCategoryProducts(
      products,
      buildFilters({ graphics: ['NVIDIA RTX 4070'] }),
      true
    );

    expect(result.map((product) => product.id)).toEqual(['rtx']);
  });

  it('matches a product when any selected color is present', () => {
    const products = [
      buildProduct({ id: 'blk', colors: ['Black'] }),
      buildProduct({
        id: 'blu',
        colors: [{ name: 'Blue', value: '#0000ff' }],
      }),
    ];

    const result = filterCategoryProducts(
      products,
      buildFilters({ colors: ['Blue'] }),
      true
    );

    expect(result.map((p) => p.id)).toEqual(['blu']);
  });
});

describe('hasActiveFilterSelection', () => {
  it('is false for the initial filter state', () => {
    expect(
      hasActiveFilterSelection(INITIAL_CATEGORY_FILTER_STATE, true)
    ).toBe(false);
  });

  it('is false when client filters are disabled even with a selection', () => {
    expect(
      hasActiveFilterSelection(buildFilters({ brand: ['Apple'] }), false)
    ).toBe(false);
  });

  it('is true when a facet is selected', () => {
    expect(
      hasActiveFilterSelection(buildFilters({ brand: ['Apple'] }), true)
    ).toBe(true);
  });

  it('is true when the price range differs from the default', () => {
    expect(
      hasActiveFilterSelection(buildFilters({ minPrice: 5000 }), true)
    ).toBe(true);
  });
});

describe('shouldRouteGraphicsChangeThroughServer', () => {
  it('routes through the server when client filters are unavailable', () => {
    expect(
      shouldRouteGraphicsChangeThroughServer({
        canUseClientFilters: false,
        hasServerGraphicsFilter: true,
        hasUrlGraphicsSelection: false,
      })
    ).toBe(true);
  });

  it('routes through the server for a URL-driven selection', () => {
    expect(
      shouldRouteGraphicsChangeThroughServer({
        canUseClientFilters: true,
        hasServerGraphicsFilter: true,
        hasUrlGraphicsSelection: true,
      })
    ).toBe(true);
  });

  it('keeps graphics local when the full set is loaded with no URL selection', () => {
    expect(
      shouldRouteGraphicsChangeThroughServer({
        canUseClientFilters: true,
        hasServerGraphicsFilter: true,
        hasUrlGraphicsSelection: false,
      })
    ).toBe(false);
  });

  it('is false without a server graphics filter', () => {
    expect(
      shouldRouteGraphicsChangeThroughServer({
        canUseClientFilters: false,
        hasServerGraphicsFilter: false,
        hasUrlGraphicsSelection: false,
      })
    ).toBe(false);
  });
});

describe('buildCategoryDisplayTitle', () => {
  it('returns All Products for the All route', () => {
    expect(buildCategoryDisplayTitle('All')).toBe('All Products');
  });

  it('humanizes a category slug', () => {
    expect(buildCategoryDisplayTitle('gaming-laptops')).toBe('Gaming Laptops');
  });
});

describe('createCategoryAddToCartHandler', () => {
  it('adds the product and clears the Added state after a beat', () => {
    vi.useFakeTimers();
    try {
      const addToCart = vi.fn();
      const added: string[] = [];
      const setAddedItems = vi.fn((action: SetStateAction<string[]>) => {
        const updater =
          typeof action === 'function' ? action : () => action;
        added.splice(0, added.length, ...updater(added));
      });
      const handler = createCategoryAddToCartHandler(addToCart, setAddedItems);
      const product = buildProduct({ id: 'p1' });

      handler({} as Parameters<typeof handler>[0], product);

      expect(addToCart).toHaveBeenCalledTimes(1);
      expect(added).toEqual(['p1']);
      vi.advanceTimersByTime(2000);
      expect(added).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
