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
    hasSuggestionsResponse: true,
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

  it('submits a clicked popular search when submission is wired', () => {
    const popularSearches = [
      { search_query: 'galaxy', search_count: 42 },
    ] as ComponentProps<typeof SearchAutocompletePopup>['popularSearches'];
    const { props } = renderPopup({
      canSubmitSearch: true,
      popularSearches,
    });

    fireEvent.click(screen.getByRole('option', { name: /galaxy/i }));

    expect(props.onChange).toHaveBeenCalledWith('galaxy');
    expect(props.onSubmitSearch).toHaveBeenCalledWith('galaxy');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('fills the input without submitting a clicked popular search for legacy consumers', () => {
    const popularSearches = [
      { search_query: 'galaxy', search_count: 42 },
    ] as ComponentProps<typeof SearchAutocompletePopup>['popularSearches'];
    const { props } = renderPopup({
      canSubmitSearch: false,
      popularSearches,
    });

    fireEvent.click(screen.getByRole('option', { name: /galaxy/i }));

    expect(props.onChange).toHaveBeenCalledWith('galaxy');
    expect(props.onSubmitSearch).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('reports a clicked popular search without submitting when submission is unwired', () => {
    const popularSearches = [
      { search_query: 'galaxy', search_count: 42 },
    ] as ComponentProps<typeof SearchAutocompletePopup>['popularSearches'];
    const onPopularSearchSelect = vi.fn();
    const { props } = renderPopup({
      canSubmitSearch: false,
      onPopularSearchSelect,
      popularSearches,
    });

    fireEvent.click(screen.getByRole('option', { name: /galaxy/i }));

    expect(onPopularSearchSelect).toHaveBeenCalledExactlyOnceWith('galaxy');
    expect(props.onSubmitSearch).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not report a clicked popular search when submission is wired', () => {
    const popularSearches = [
      { search_query: 'galaxy', search_count: 42 },
    ] as ComponentProps<typeof SearchAutocompletePopup>['popularSearches'];
    const onPopularSearchSelect = vi.fn();
    const { props } = renderPopup({
      canSubmitSearch: true,
      onPopularSearchSelect,
      popularSearches,
    });

    fireEvent.click(screen.getByRole('option', { name: /galaxy/i }));

    expect(props.onSubmitSearch).toHaveBeenCalledWith('galaxy');
    expect(onPopularSearchSelect).not.toHaveBeenCalled();
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

  it('withholds the no-suggestions note until the request settles', () => {
    const { rerender, props } = renderPopup({
      canSubmitSearch: true,
      hasResults: false,
      hasSuggestionsResponse: false,
      suggestions: [],
    });

    // During the debounce, while loading, or after a failure the popup
    // offers the submit action without claiming there are no suggestions.
    expect(screen.queryByText(/no suggestions for/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /see all results/i })
    ).toBeInTheDocument();

    rerender(
      <SearchAutocompletePopup {...props} hasSuggestionsResponse={true} />
    );

    expect(screen.getByText(/no suggestions for/i)).toBeInTheDocument();
  });

  it('announces the loading status while a fetch is pending', () => {
    renderPopup({ loading: true });

    expect(screen.getByText('Searching…')).toBeInTheDocument();
  });

  it('themes the full-search action with storefront variables', () => {
    // Fixed grays would not adapt to dark merchant palettes.
    renderPopup({ canSubmitSearch: true });

    const action = screen.getByRole('button', { name: /see all results/i });
    expect(action).toHaveClass('border-store-border');
    expect(action).toHaveClass('bg-store-secondary');
    expect(action.className).not.toContain('gray-');
  });
});
