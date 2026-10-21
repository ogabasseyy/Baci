import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchSortSelect } from './search-sort-select';

describe('search sort select', () => {
  it('shows the selected sort label and commits a new sort order', () => {
    const onSortChange = vi.fn();
    render(
      <SearchSortSelect
        sort="price_asc"
        pending={false}
        onSortChange={onSortChange}
      />
    );
    expect(screen.getByText('Sort: Price: low to high')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Sort by'), {
      target: { value: 'newest' },
    });
    expect(onSortChange).toHaveBeenCalledWith('newest');
  });
  it('announces pending navigation instead of the sort label', () => {
    render(
      <SearchSortSelect sort="relevance" pending onSortChange={() => {}} />
    );
    expect(screen.getByText('Updating results…')).toBeInTheDocument();
  });
});
