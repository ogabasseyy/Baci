import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  createRefinementDraft,
  SearchRefinementFields,
} from './search-refinement-fields';

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
