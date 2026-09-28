import type { KeyboardEvent } from 'react';
import { getProductUrl } from '@/lib/product-url';
import type {
  AutocompletePopularSearch,
  AutocompleteProduct,
} from './search-autocomplete-types';

interface AutocompleteKeyDownInput {
  highlightedIndex: number;
  onChange: (value: string) => void;
  onClose: () => void;
  onHighlight: (updater: (prev: number) => number) => void;
  onSelectProduct?: (url: string) => void;
  onSubmitSearch?: (query: string) => void;
  popularSearches: AutocompletePopularSearch[];
  suggestions: AutocompleteProduct[];
  value: string;
}

/**
 * Builds the combobox keyboard handler: arrow navigation across product and
 * popular-search options, Enter to activate the highlight (or submit the
 * typed query when a submit handler is wired), Escape to close.
 */
export function createAutocompleteKeyDownHandler({
  highlightedIndex,
  onChange,
  onClose,
  onHighlight,
  onSelectProduct,
  onSubmitSearch,
  popularSearches,
  suggestions,
  value,
}: AutocompleteKeyDownInput) {
  return (e: KeyboardEvent) => {
    const totalItems = suggestions.length + popularSearches.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onHighlight((prev) => (prev < totalItems - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onHighlight((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      if (highlightedIndex < suggestions.length) {
        const product = suggestions[highlightedIndex];
        onSelectProduct?.(getProductUrl(product));
        onClose();
      } else {
        const searchIndex = highlightedIndex - suggestions.length;
        const search = popularSearches[searchIndex];
        if (onSubmitSearch) {
          onSubmitSearch(search.search_query);
        } else {
          onChange(search.search_query);
        }
        onClose();
      }
    } else if (e.key === 'Enter' && highlightedIndex < 0) {
      // With an explicit submit handler, Enter always submits the typed
      // query as a browsable search — even when product suggestions exist.
      // Blank queries stay on the current page. Without the handler, keep
      // the legacy behavior of opening the first product suggestion.
      if (onSubmitSearch) {
        if (value.trim()) {
          e.preventDefault();
          onSubmitSearch(value);
          onClose();
        }
      } else if (suggestions.length > 0) {
        e.preventDefault();
        onSelectProduct?.(getProductUrl(suggestions[0]));
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };
}
