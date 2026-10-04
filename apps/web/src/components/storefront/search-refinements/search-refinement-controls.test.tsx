import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { SearchRefinementControls } from './search-refinement-controls';

const props = {
  query: 'phone',
  basePath: '/oga/search',
  criteria: { brands: [], sort: 'relevance' as const },
  brands: ['Apple', 'Samsung'],
  categories: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Phones' }],
};
describe('search refinements controls', () => {
  it('collapses the applied-filter row until a filter is active', () => {
    const view = render(<SearchRefinementControls {...props} />);
    expect(screen.queryByRole('group', { name: 'Applied filters' })).toBeNull();
    view.rerender(
      <SearchRefinementControls
        {...props}
        criteria={{ ...props.criteria, minPrice: 1 }}
      />
    );
    expect(
      screen.getByRole('group', { name: 'Applied filters' })
    ).toBeInTheDocument();
  });
  it('groups Sort and Filters in a header and opens the Price dropdown', () => {
    render(<SearchRefinementControls {...props} />);
    const header = screen.getByRole('toolbar', {
      name: 'Sort and filter results',
    });
    expect(
      within(header).getByRole('button', { name: 'Sort' })
    ).toBeInTheDocument();
    expect(
      within(header).getByRole('button', { name: 'Filters' })
    ).toBeInTheDocument();
    const price = screen.getByRole('button', { name: 'Price' });
    expect(price).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(price);
    expect(price).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('uses concise quick-filter labels', () => {
    render(<SearchRefinementControls {...props} />);
    for (const label of ['Price', 'Brand', 'Condition']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: `${label} filters` })
      ).toBeNull();
    }
  });
  it('restores desktop price inputs when history restores a different price range', () => {
    const { rerender } = render(
      <SearchRefinementControls
        {...props}
        criteria={{ ...props.criteria, maxPrice: 100 }}
      />
    );
    expect(screen.getByLabelText('Maximum price (₦)')).toHaveValue('100');
    rerender(
      <SearchRefinementControls
        {...props}
        criteria={{ ...props.criteria, maxPrice: 500 }}
      />
    );
    expect(screen.getByLabelText('Maximum price (₦)')).toHaveValue('500');
  });
  it('discards an unsaved price draft on Back even when committed bounds are unchanged', () => {
    render(
      <SearchRefinementControls
        {...props}
        criteria={{ ...props.criteria, maxPrice: 500 }}
      />
    );
    fireEvent.change(screen.getByLabelText('Maximum price (₦)'), {
      target: { value: '900' },
    });
    window.history.replaceState(
      null,
      '',
      '/oga/search?q=phone&brand=Apple&maxPrice=500'
    );
    fireEvent(window, new PopStateEvent('popstate'));
    expect(screen.getByLabelText('Maximum price (₦)')).toHaveValue('500');
  });
  it('keeps mobile drafts local until Apply and cancels Close', () => {
    render(<SearchRefinementControls {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Brand' })
    );
    let dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Apple' }));
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Close filters' })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Brand' })
    );
    dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('checkbox', { name: 'Apple' })
    ).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Apple' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Samsung' }));
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Apply filters' })
    );
    expect(push).toHaveBeenCalledWith(
      '/oga/search?q=phone&brand=Apple&brand=Samsung'
    );
  });
  it('does not submit invalid price bounds', () => {
    render(<SearchRefinementControls {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Price' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Minimum price (₦)'), {
      target: { value: '300' },
    });
    fireEvent.change(within(dialog).getByLabelText('Maximum price (₦)'), {
      target: { value: '100' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Apply filters' })
    );
    expect(within(dialog).getByRole('alert')).toBeInTheDocument();
  });
});

it('puts smart chips above the toolbar and applies a query-backed processor', () => {
  render(
    <SearchRefinementControls
      {...props}
      processors={['Intel Core i7']}
      categories={[
        { id: '00000000-0000-4000-8000-000000000001', name: 'Laptops' },
        { id: '00000000-0000-4000-8000-000000000002', name: 'Gaming Laptops' },
      ]}
    />
  );
  expect(screen.getByRole('button', { name: 'Type' })).toBeInTheDocument();
  const processor = screen.getByRole('button', { name: 'Processor' });
  expect(
    processor.compareDocumentPosition(screen.getByRole('toolbar')) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  fireEvent.click(processor);
  const dialog = screen.getByRole('dialog');
  fireEvent.change(
    within(dialog).getByRole('combobox', { name: 'Processor' }),
    { target: { value: 'Intel Core i7' } }
  );
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Apply filters' })
  );
  expect(push).toHaveBeenCalledWith(
    expect.stringContaining('processor=Intel+Core+i7')
  );
});

it('uses merchant currency for applied chips, desktop fields and mobile fields', () => {
  render(
    <SearchRefinementControls
      {...props}
      currency="USD"
      criteria={{ ...props.criteria, minPrice: 100 }}
    />
  );
  expect(
    screen.getByRole('group', { name: 'Applied filters' })
  ).toHaveTextContent('$100');
  expect(screen.getByLabelText(/Minimum price \(.*\$\)/)).toHaveValue('100');
  fireEvent.click(screen.getByRole('button', { name: 'Price' }));
  expect(
    within(screen.getByRole('dialog')).getByLabelText(/Minimum price \(.*\$\)/)
  ).toHaveValue('100');
  expect(screen.queryByLabelText('Minimum price (₦)')).toBeNull();
});
