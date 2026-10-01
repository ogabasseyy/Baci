import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductGridEmptyState } from './product-grid-empty-state';

describe('ProductGridEmptyState', () => {
  it('names the search query when a search matches nothing', () => {
    render(
      <ProductGridEmptyState
        searchQuery="unobtainium"
        selectedCategory="All"
        filterType="category"
      />
    );

    expect(screen.getByRole('heading', { name: 'No products found' }));
    expect(
      screen.getByText(/Your search for "unobtainium" did not match/)
    ).toBeInTheDocument();
  });

  it('names the price range, brand, and category variants', () => {
    const { rerender } = render(
      <ProductGridEmptyState
        searchQuery={undefined}
        selectedCategory="Under $50"
        filterType="price"
      />
    );
    expect(screen.getByText(/in this price range/)).toBeInTheDocument();

    rerender(
      <ProductGridEmptyState
        searchQuery={undefined}
        selectedCategory="Acme"
        filterType="brand"
      />
    );
    expect(screen.getByText(/for this brand/)).toBeInTheDocument();

    rerender(
      <ProductGridEmptyState
        searchQuery={undefined}
        selectedCategory="Phones"
        filterType="category"
      />
    );
    expect(screen.getByText(/in this category/)).toBeInTheDocument();
  });

  it('falls back to the generic message with no query or filter', () => {
    render(
      <ProductGridEmptyState
        searchQuery={undefined}
        selectedCategory="All"
        filterType="category"
      />
    );

    expect(
      screen.getByText('No products are currently available.')
    ).toBeInTheDocument();
  });
});
