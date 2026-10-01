import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '../types';

vi.mock('@/lib/routes', () => ({ asRoute: (p: string) => p }));
vi.mock('../components/AdUnit', () => ({ AdUnit: () => null }));
vi.mock('../components/CategoryFiltersSidebar', () => ({
  CategoryFiltersSidebar: () => <div aria-label="Filters sidebar" />,
}));
vi.mock('../components/ProductCard', () => ({
  ProductCard: ({
    product,
    onAddToCart,
    contentVisibilityClassName,
  }: {
    product: { name: string };
    onAddToCart?: (event: React.MouseEvent, product: unknown) => void;
    contentVisibilityClassName?: string;
  }) => (
    <article
      aria-label={product.name}
      className={contentVisibilityClassName || undefined}
    >
      <button type="button" onClick={(event) => onAddToCart?.(event, product)}>
        Add {product.name}
      </button>
    </article>
  ),
}));
vi.mock('../components/StorefrontPagination', () => ({
  StorefrontPagination: ({ basePath }: { basePath: string }) => (
    <nav aria-label="Pagination">{basePath}</nav>
  ),
}));

import { CategoryPageResults } from './category-page-results';

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: '1',
    name: 'Phone',
    slug: 'phone',
    description: '',
    price: '₦100',
    rawPrice: 100,
    image: '',
    condition: 'New',
    ...overrides,
  } as Product;
}

function renderResults(
  overrides: Partial<React.ComponentProps<typeof CategoryPageResults>> = {}
) {
  const onAddToCart = vi.fn();
  const onClearFilters = vi.fn();
  const products = [buildProduct({ id: 'a', name: 'Phone A' })];

  render(
    <CategoryPageResults
      canShowFilters={true}
      showPriceFilter={true}
      filters={{} as never}
      availableOptions={{} as never}
      onFilterChange={vi.fn()}
      onClearFilters={onClearFilters}
      viewMode="grid"
      visibleProducts={products}
      addedItems={[]}
      onAddToCart={onAddToCart}
      hasKnownProducts={true}
      hasVisibleProducts={true}
      hasActiveFilters={false}
      filteredProductCount={1}
      pageStartIndex={0}
      visibleProductEndIndex={1}
      paginationProductCount={1}
      currentPageNumber={1}
      totalPages={1}
      pageTitle="Smartphones"
      categoryPath="/test-store/smartphones"
      {...overrides}
    />
  );

  return { onAddToCart, onClearFilters };
}

describe('CategoryPageResults', () => {
  it('renders the product grid and forwards add-to-cart clicks', () => {
    const { onAddToCart } = renderResults();

    expect(
      screen.getByRole('article', { name: 'Phone A' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Phone A' }));
    expect(onAddToCart).toHaveBeenCalledTimes(1);
  });

  it('shows the "no products found" empty state and clear action', () => {
    const { onClearFilters } = renderResults({
      hasKnownProducts: false,
      hasVisibleProducts: false,
      visibleProducts: [],
    });

    expect(screen.getByText('No products found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('shows the temporarily-unavailable state when the slice is empty but products exist', () => {
    renderResults({
      hasVisibleProducts: false,
      visibleProducts: [],
      currentPageNumber: 2,
      totalPages: 2,
    });

    expect(
      screen.getByText('Products on this page are temporarily unavailable.')
    ).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  });

  it('renders the filtered-results message instead of pagination when filters are active', () => {
    renderResults({ hasActiveFilters: true, filteredProductCount: 3 });

    expect(
      screen.getByText(/Filtered results show all 3 matching products/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Pagination' })
    ).not.toBeInTheDocument();
  });

  it('renders pagination with the category path when filters are inactive', () => {
    renderResults();

    expect(
      screen.getByRole('navigation', { name: 'Pagination' })
    ).toHaveTextContent('/test-store/smartphones');
    expect(
      screen.getByText('Showing 1-1 of 1 products')
    ).toBeInTheDocument();
  });

  // Part 1 — content-visibility is applied to product cards ONLY in filtered
  // mode (the unbounded single-page render), with responsive reservations
  // derived per view mode. Paginated (bounded, above-the-fold) cards get none.
  it('reserves responsive content-visibility on grid cards in filtered mode', () => {
    renderResults({ hasActiveFilters: true, viewMode: 'grid' });

    const card = screen.getByRole('article', { name: 'Phone A' });
    expect(card).toHaveClass('content-auto');
    expect(card).toHaveClass('[contain-intrinsic-size:auto_300px]');
    expect(card).toHaveClass('md:[contain-intrinsic-size:auto_460px]');
  });

  it('reserves responsive content-visibility on list cards in filtered mode', () => {
    renderResults({ hasActiveFilters: true, viewMode: 'list' });

    const card = screen.getByRole('article', { name: 'Phone A' });
    expect(card).toHaveClass('content-auto');
    expect(card).toHaveClass('[contain-intrinsic-size:auto_190px]');
    expect(card).toHaveClass('md:[contain-intrinsic-size:auto_240px]');
  });

  it('does not apply content-visibility to grid cards in paginated mode', () => {
    renderResults({ hasActiveFilters: false, viewMode: 'grid' });

    const card = screen.getByRole('article', { name: 'Phone A' });
    expect(card).not.toHaveClass('content-auto');
    expect(card.className).toBe('');
  });

  it('does not apply content-visibility to list cards in paginated mode', () => {
    renderResults({ hasActiveFilters: false, viewMode: 'list' });

    const card = screen.getByRole('article', { name: 'Phone A' });
    expect(card).not.toHaveClass('content-auto');
    expect(card.className).toBe('');
  });
});
