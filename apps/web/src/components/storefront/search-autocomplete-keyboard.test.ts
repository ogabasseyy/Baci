import type { KeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createAutocompleteKeyDownHandler } from './search-autocomplete-keyboard';
import type {
  AutocompletePopularSearch,
  AutocompleteProduct,
} from './search-autocomplete-types';

const suggestions = [
  { id: 'p1', name: 'iPhone', price: 100, image_small: '' },
] as AutocompleteProduct[];
const popularSearches = [
  { search_query: 'galaxy', search_count: 42 },
] as AutocompletePopularSearch[];

function setup(
  overrides: Partial<
    Parameters<typeof createAutocompleteKeyDownHandler>[0]
  > = {}
) {
  const handlers = {
    highlightedIndex: -1,
    onChange: vi.fn(),
    onClose: vi.fn(),
    onHighlight: vi.fn(),
    onSelectProduct: vi.fn(),
    onSubmitSearch: undefined as ((query: string) => void) | undefined,
    popularSearches,
    suggestions,
    value: 'iph',
    ...overrides,
  };
  const handleKeyDown = createAutocompleteKeyDownHandler(handlers);
  const press = (key: string) => {
    const event = {
      key,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    handleKeyDown(event);
    return event;
  };
  return { handlers, press };
}

describe('createAutocompleteKeyDownHandler', () => {
  it('moves the highlight with arrow keys', () => {
    const onHighlight = vi.fn();
    const { press } = setup({ onHighlight });

    press('ArrowDown');

    expect(onHighlight).toHaveBeenCalledTimes(1);
    const updater = onHighlight.mock.calls[0][0] as (prev: number) => number;
    expect(updater(-1)).toBe(0);
    expect(updater(1)).toBe(1);
  });

  it('opens the highlighted product on Enter', () => {
    const { handlers, press } = setup({ highlightedIndex: 0 });

    const event = press('Enter');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(handlers.onSelectProduct).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('submits a highlighted popular search through the submit handler', () => {
    const onSubmitSearch = vi.fn();
    const { handlers, press } = setup({
      highlightedIndex: 1,
      onSubmitSearch,
    });

    press('Enter');

    expect(handlers.onChange).toHaveBeenCalledWith('galaxy');
    expect(onSubmitSearch).toHaveBeenCalledWith('galaxy');
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('falls back to the typed value when the highlight outlives its options', () => {
    const onSubmitSearch = vi.fn();
    const { handlers, press } = setup({
      highlightedIndex: 3,
      onSubmitSearch,
      popularSearches: [],
      suggestions: [],
      value: 'x',
    });

    const event = press('Enter');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(onSubmitSearch).toHaveBeenCalledWith('x');
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('submits the typed query on Enter when nothing is highlighted', () => {
    const onSubmitSearch = vi.fn();
    const { handlers, press } = setup({ onSubmitSearch, value: 'x' });

    press('Enter');

    expect(onSubmitSearch).toHaveBeenCalledWith('x');
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps blank queries on the page instead of submitting', () => {
    const onSubmitSearch = vi.fn();
    const { handlers, press } = setup({ onSubmitSearch, value: '   ' });

    const event = press('Enter');

    expect(onSubmitSearch).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it('opens the first product on Enter without a submit handler', () => {
    const { handlers, press } = setup();

    press('Enter');

    expect(handlers.onSelectProduct).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the popup on Escape', () => {
    const { handlers, press } = setup();

    press('Escape');

    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });
});
