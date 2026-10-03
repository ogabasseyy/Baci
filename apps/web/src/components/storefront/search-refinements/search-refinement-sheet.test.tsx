import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createRefinementDraft } from './search-refinement-fields';
import { SearchRefinementSheet } from './search-refinement-sheet';

it('changes sorting without losing the committed filters', () => {
  const criteria = {
    brands: ['Apple'],
    maxPrice: 500,
    sort: 'relevance' as const,
  };
  const commit = vi.fn();
  render(
    <SearchRefinementSheet
      restoreFocus={vi.fn()}
      panel="sort"
      setPanel={vi.fn()}
      focusGroup="brand"
      criteria={criteria}
      commit={commit}
      draft={createRefinementDraft(criteria)}
      setDraft={vi.fn()}
      error={null}
      setError={vi.fn()}
      brands={['Apple']}
      categories={[]}
      apply={vi.fn()}
    />
  );
  fireEvent.click(screen.getByRole('radio', { name: 'Price: low to high' }));
  expect(commit).toHaveBeenCalledWith({ ...criteria, sort: 'price_asc' });
});
