import { describe, expect, it } from 'vitest';
import type { FilterState } from '../components/CategoryFiltersSidebar';
import type { Product } from '../types';
import {
  buildAvailableFilterOptions,
  EMPTY_AVAILABLE_FILTER_OPTIONS,
  filterCategoryProducts,
  getCategoryProductColorName,
  hasActiveFilterSelection,
  INITIAL_CATEGORY_FILTER_STATE,
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
