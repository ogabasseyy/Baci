import type { KeyboardEvent } from 'react';
import { getProductUrl } from '@/lib/product-url';
import type {
  AutocompletePopularSearch,
  AutocompleteProduct,
} from './search-autocomplete-types';

interface AutocompleteKeyDownInput {
  highlightedIndex: number;
  isSubmittableQuery?: (query: string) => boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onHighlight: (updater: (prev: number) => number) => void;
  onPopularSearchSelect?: (query: string) => void;
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
  isSubmittableQuery,
  onChange,
  onClose,
  onHighlight,
  onPopularSearchSelect,
  onSelectProduct,
  onSubmitSearch,
  popularSearches,
  suggestions,
  value,
}: AutocompleteKeyDownInput) {
  return (e: KeyboardEvent) => {
    const totalItems = suggestions.length + popularSearches.length;
    // A highlight can outlive its options when the query is edited down and
    // the arrays clear while the submit popup stays open. Treat a stale
    // index as no highlight so Enter falls back to the typed value instead
    // of dereferencing a missing option.
    const hasHighlight = highlightedIndex >= 0 && highlightedIndex < totalItems;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onHighlight((prev) => (prev < totalItems - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onHighlight((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter' && hasHighlight) {
      e.preventDefault();
      if (highlightedIndex < suggestions.length) {
        const product = suggestions[highlightedIndex];
        onSelectProduct?.(getProductUrl(product));
        onClose();
      } else {
        const searchIndex = highlightedIndex - suggestions.length;
        const search = popularSearches[searchIndex];
        // Sync the controlled input first: submit-wired consumers (e.g. the
        // navbar) persist across the navigation, so the input must display
        // the submitted suggestion rather than the previous text.
        onChange(search.search_query);
        if (onSubmitSearch) {
          onSubmitSearch(search.search_query);
        } else {
          onPopularSearchSelect?.(search.search_query);
        }
        onClose();
      }
    } else if (e.key === 'Enter' && !hasHighlight) {
      // With an explicit submit handler, Enter always submits the typed
      // query as a browsable search — even when product suggestions exist.
      // Blank or validator-rejected queries stay put with the popup open
      // (no submit, no close) instead of dropping a no-op submission.
      // Without the handler, keep the legacy behavior of opening the
      // first product suggestion.
      if (onSubmitSearch) {
        if (value.trim() && (isSubmittableQuery?.(value) ?? true)) {
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
      // Dismissing hides the popup: the highlight must go with it, or a
      // later Enter would follow the invisible option instead of
      // submitting the typed query. Retained options stay so refocusing
      // restores them.
      onHighlight(() => -1);
      onClose();
    }
  };
}
