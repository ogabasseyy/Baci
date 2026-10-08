import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createRefinementDraft } from './search-refinement-draft';
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

it('follows the requested group when the quick-filter target changes', () => {
  const { rerender } = render(
    <SearchRefinementSheet
      restoreFocus={vi.fn()}
      panel="filters"
      setPanel={vi.fn()}
      focusGroup="price"
      criteria={{ brands: [], sort: 'relevance' }}
      commit={vi.fn()}
      draft={createRefinementDraft({ brands: [], sort: 'relevance' })}
      setDraft={vi.fn()}
      error={null}
      setError={vi.fn()}
      brands={[]}
      categories={[]}
      apply={vi.fn()}
    />
  );
  expect(
    screen.getByRole('button', { name: /Price/ }).getAttribute('aria-expanded')
  ).toBe('true');
  rerender(
    <SearchRefinementSheet
      restoreFocus={vi.fn()}
      panel="filters"
      setPanel={vi.fn()}
      focusGroup="brand"
      criteria={{ brands: [], sort: 'relevance' }}
      commit={vi.fn()}
      draft={createRefinementDraft({ brands: [], sort: 'relevance' })}
      setDraft={vi.fn()}
      error={null}
      setError={vi.fn()}
      brands={[]}
      categories={[]}
      apply={vi.fn()}
    />
  );
  expect(
    screen.getByRole('button', { name: /Price/ }).getAttribute('aria-expanded')
  ).toBe('false');
  expect(
    screen.getByRole('button', { name: /Brand/ }).getAttribute('aria-expanded')
  ).toBe('true');
});
