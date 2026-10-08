import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createRefinementDraft } from './search-refinement-draft';
import { SearchRefinementFields } from './search-refinement-fields';

it('keeps selected exact brands visible while searching other brands', () => {
  const onChange = vi.fn();
  render(
    <SearchRefinementFields
      draft={createRefinementDraft({
        brands: [' Samsung '],
        sort: 'relevance',
      })}
      onChange={onChange}
      brands={['Apple', ' Samsung ', 'LG', 'HP', 'Dell', 'Asus', 'Acer']}
      categories={[]}
    />
  );
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search brands' }), {
    target: { value: 'Apple' },
  });
  expect(screen.getByText('Selected: Samsung')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Apple' }));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ brands: [' Samsung ', 'Apple'] })
  );
});

it('merges case-variant draft brands into the facet spelling', () => {
  const onChange = vi.fn();
  render(
    <SearchRefinementFields
      draft={createRefinementDraft({
        brands: ['apple'],
        sort: 'relevance',
      })}
      onChange={onChange}
      brands={['Apple', 'Samsung']}
      categories={[]}
    />
  );
  // One checkbox in the facet spelling, checked via the draft value.
  const boxes = screen.getAllByRole('checkbox', { name: 'Apple' });
  expect(boxes).toHaveLength(1);
  expect(boxes[0]).toBeChecked();
  // Deselecting clears the equivalent lowercase constraint entirely.
  fireEvent.click(boxes[0]);
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ brands: [] })
  );
});

it('merges a case-variant draft processor into the facet spelling', () => {
  render(
    <SearchRefinementFields
      draft={createRefinementDraft({
        brands: [],
        processor: 'intel core i7',
        sort: 'relevance',
      })}
      onChange={vi.fn()}
      brands={[]}
      categories={[]}
      processors={['Intel Core i7', 'M1']}
    />
  );
  // One option in the facet spelling, selected via the draft value.
  const options = screen.getAllByRole('option', { name: 'Intel Core i7' });
  expect(options).toHaveLength(1);
  expect(
    (screen.getByRole('combobox', { name: 'Processor' }) as HTMLSelectElement)
      .value
  ).toBe('Intel Core i7');
});

it('commits a minimum rating through the draft field', () => {
  const onChange = vi.fn();
  render(
    <SearchRefinementFields
      brands={[]}
      categories={[]}
      draft={createRefinementDraft({ brands: [], sort: 'relevance' })}
      onChange={onChange}
    />
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Rating' }), {
    target: { value: '4' },
  });
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ minRating: 4 })
  );
});

it('shows only available conditions and collapses other mobile groups', () => {
  render(
    <SearchRefinementFields
      focusGroup="condition"
      conditions={['used']}
      brands={['Apple']}
      categories={[]}
      draft={createRefinementDraft({ brands: [], sort: 'relevance' })}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByRole('option', { name: 'Used' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'New' })).not.toBeInTheDocument();
  expect(
    screen.queryByRole('checkbox', { name: 'Apple' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Brand/ }));
  expect(screen.getByRole('checkbox', { name: 'Apple' })).toBeInTheDocument();
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('option', { name: 'Used' })
  ).not.toBeInTheDocument();
});

it('keeps the draft condition selectable after it leaves the facet response', () => {
  render(
    <SearchRefinementFields
      focusGroup="condition"
      conditions={['new']}
      brands={[]}
      categories={[]}
      draft={createRefinementDraft({
        brands: [],
        sort: 'relevance',
        condition: 'used',
      })}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByRole('option', { name: 'Used' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Condition' })).toHaveValue(
    'used'
  );
});

it('surfaces a deactivated draft category instead of showing all categories', () => {
  render(
    <SearchRefinementFields
      focusGroup="category"
      categories={[{ id: 'c1', name: 'Phones' }]}
      brands={[]}
      draft={createRefinementDraft({
        brands: [],
        sort: 'relevance',
        categoryId: 'c2',
      })}
      onChange={vi.fn()}
    />
  );
  expect(
    screen.getByRole('option', { name: 'Unavailable category' })
  ).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('c2');
});
