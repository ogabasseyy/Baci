import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SearchAutocompletePopup } from './search-autocomplete-popup';
import type {
  AutocompletePopularSearch,
  AutocompleteProduct,
} from './search-autocomplete-types';

vi.mock('next/image', () => ({
  // biome-ignore lint/performance/noImgElement: mock implementation requires img
  default: (props: ComponentProps<'img'>) => <img {...props} alt={props.alt} />,
}));

const product = {
  id: 'p1',
  name: 'iPhone 16',
  price: 999,
  image_small: 'https://example.com/iphone.jpg',
  slug: 'iphone-16',
} as AutocompleteProduct;

function renderPopup(
  overrides: Partial<ComponentProps<typeof SearchAutocompletePopup>> = {}
) {
  const props: ComponentProps<typeof SearchAutocompletePopup> = {
    canSubmitSearch: false,
    formatCurrencyCompact: (price: number) => `$${price}`,
    hasResults: true,
    highlightedIndex: -1,
    listboxId: 'search-listbox-m1',
    loading: false,
    onChange: vi.fn(),
    onClose: vi.fn(),
    onSelectProduct: vi.fn(),
    onSubmitSearch: vi.fn(),
    popularSearches: [] as AutocompletePopularSearch[],
    suggestions: [product],
    trimmedValue: 'iph',
    value: 'iph',
    ...overrides,
  };

  return { props, ...render(<SearchAutocompletePopup {...props} />) };
}

describe('SearchAutocompletePopup', () => {
  it('renders product options that select and close', () => {
    const { props } = renderPopup();

    fireEvent.click(screen.getByRole('option', { name: /iphone 16/i }));

    expect(props.onSelectProduct).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the submit action outside the listbox ownership', () => {
    renderPopup({ canSubmitSearch: true });

    const listbox = screen.getByRole('listbox');
    const action = screen.getByRole('button', {
      name: /see all results for/i,
    });

    expect(listbox).not.toContainElement(action);
  });

  it('themes the submit action with the merchant primary color', () => {
    renderPopup({ canSubmitSearch: true });

    const action = screen.getByRole('button', {
      name: /see all results for/i,
    });

    expect(action).toHaveClass('text-store-primary');
    expect(action.className).toContain('hover:bg-store-primary/10');
    expect(action.className).toContain('focus-visible:ring-store-primary');
    expect(action.className).not.toContain('red-600');
    expect(action.className).not.toContain('red-50');
  });

  it('submits the raw query and closes when the action is pressed', () => {
    const { props } = renderPopup({
      canSubmitSearch: true,
      value: '  x ',
      trimmedValue: 'x',
    });

    fireEvent.click(screen.getByRole('button', { name: /see all results/i }));

    expect(props.onSubmitSearch).toHaveBeenCalledWith('  x ');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the no-suggestions note only when submission is wired', () => {
    const { rerender, props } = renderPopup({
      canSubmitSearch: true,
      hasResults: false,
      suggestions: [],
    });

    expect(screen.getByText(/no suggestions for/i)).toBeInTheDocument();

    rerender(
      <SearchAutocompletePopup
        {...props}
        canSubmitSearch={false}
        hasResults={false}
        suggestions={[]}
      />
    );

    expect(screen.queryByText(/no suggestions for/i)).not.toBeInTheDocument();
  });

  it('announces the loading status while a fetch is pending', () => {
    renderPopup({ loading: true });

    expect(screen.getByText('Searching…')).toBeInTheDocument();
  });
});
