import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProductGridSearchStatus } from './product-grid-search-status';

describe('ProductGridSearchStatus', () => {
  it('shows the server search error with the last results', () => {
    render(
      <ProductGridSearchStatus
        searchError="boom"
        debouncedSearchQuery="phone"
        showPreviewFailure={false}
        onRetrySearch={() => undefined}
        isLoading={false}
        isSearching={false}
        resultCount={3}
        selectedCategory="All"
      />
    );

    expect(
      screen.getByText(/Search is temporarily unavailable/)
    ).toBeInTheDocument();
  });

  it('offers a retry when preview search fails to load', () => {
    const onRetrySearch = vi.fn();
    render(
      <ProductGridSearchStatus
        searchError={null}
        debouncedSearchQuery="phone"
        showPreviewFailure
        onRetrySearch={onRetrySearch}
        isLoading={false}
        isSearching={false}
        resultCount={8}
        selectedCategory="All"
      />
    );

    expect(
      screen.getByText(/Preview search could not load/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry search' }));
    expect(onRetrySearch).toHaveBeenCalledOnce();
  });

  it('announces loading and result counts to screen readers', () => {
    const { rerender } = render(
      <ProductGridSearchStatus
        searchError={null}
        debouncedSearchQuery={undefined}
        showPreviewFailure={false}
        onRetrySearch={() => undefined}
        isLoading
        isSearching={false}
        resultCount={0}
        selectedCategory="All"
      />
    );
    expect(screen.getByText('Loading products...')).toBeInTheDocument();

    rerender(
      <ProductGridSearchStatus
        searchError={null}
        debouncedSearchQuery="phone"
        showPreviewFailure={false}
        onRetrySearch={() => undefined}
        isLoading={false}
        isSearching={false}
        resultCount={2}
        selectedCategory="Phones"
      />
    );
    const announcement = screen.getByText('2 products found in Phones');
    expect(announcement.closest('[aria-live="polite"]')).toBeInTheDocument();
  });
});
