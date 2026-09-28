'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useCurrencyWithCountry } from '@/hooks/use-currency';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { createAutocompleteKeyDownHandler } from './search-autocomplete-keyboard';
import { SearchAutocompletePopup } from './search-autocomplete-popup';
import type { SearchAutocompleteProps } from './search-autocomplete-types';
import { useAutocompleteSuggestions } from './use-autocomplete-suggestions';

// Re-exported so consumers keep importing the props from this module.
export type { SearchAutocompleteProps } from './search-autocomplete-types';

export function SearchAutocomplete({
  merchantId,
  value,
  onChange,
  onSelectProduct,
  onSubmitSearch,
  placeholder = 'Search products...',
  className,
  id = 'search-input',
  name = 'q',
  autoFocus = false,
  countryCode,
  payoutCurrency,
}: SearchAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 200ms sits at the responsive end of the 200-400ms typeahead debounce range;
  // pairs with the per-request AbortController below so superseded queries cancel.
  const debouncedValue = useDebounce(value, 200);
  const safeCountryCode = countryCode || (payoutCurrency ? null : 'NG');
  const { formatCurrencyCompact } = useCurrencyWithCountry(
    safeCountryCode,
    payoutCurrency
  );

  // The popup length threshold follows the consumer contract everywhere
  // (open, focus-reopen, reset): submit-wired popups stay available for any
  // nonblank query — the results route accepts single characters — while
  // legacy popups need a fetchable (2+) query. Suggestion clearing keeps
  // the 2+ fetch gate regardless.
  const isPopupLength = (text: string) =>
    onSubmitSearch ? text.trim().length > 0 : text.length >= 2;

  const {
    clearSuggestions,
    loading,
    popularSearches,
    settledQuery,
    suggestions,
  } = useAutocompleteSuggestions({
    debouncedValue,
    merchantId,
    onResultsReceived: () => {
      setIsOpen(true);
      setHighlightedIndex(-1);
    },
  });

  const handleKeyDown = createAutocompleteKeyDownHandler({
    highlightedIndex,
    onChange,
    onClose: () => setIsOpen(false),
    onHighlight: setHighlightedIndex,
    onSelectProduct,
    onSubmitSearch,
    popularSearches,
    suggestions,
    value,
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Immediately clear suggestions when value becomes too short.
  // Adjusted inline during render with a prev-prop comparison so users never
  // see a stale committed frame between the prop change and the reset.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (value.length < 2) {
      clearSuggestions();
      // The highlight must not outlive its options: the submit popup can
      // stay open for a one-character query after the arrays clear.
      setHighlightedIndex(-1);
      if (!isPopupLength(value)) {
        setIsOpen(false);
      }
    }
  }

  // Clear stale results once the debounced query becomes too short, using the
  // same render-time prev-comparison pattern instead of an effect.
  const [prevDebouncedValue, setPrevDebouncedValue] = useState(debouncedValue);
  if (debouncedValue !== prevDebouncedValue) {
    setPrevDebouncedValue(debouncedValue);
    if (debouncedValue.length < 2) {
      clearSuggestions();
      setHighlightedIndex(-1);
      if (!isPopupLength(debouncedValue)) {
        setIsOpen(false);
      }
    }
  }

  const hasResults = suggestions.length > 0 || popularSearches.length > 0;
  const listboxId = `search-listbox-${merchantId}`;
  const resultsCount = suggestions.length + popularSearches.length;
  const trimmedValue = value.trim();
  // The explicit "See all results" action is available for any nonblank query
  // whenever the consumer wires full-search submission — including when the
  // suggestion fetch returned nothing.
  const canSubmitSearch = Boolean(onSubmitSearch) && trimmedValue.length > 0;
  const showPopup = isOpen && (hasResults || canSubmitSearch);
  // The empty-state message and its screen-reader announcement share one
  // gate: only a settled successful response may claim there are no
  // suggestions — never the debounce window, a pending request, or a
  // failure. Queries that never fetch (e.g. one character) stay silent.
  const hasSuggestionsResponse = settledQuery === debouncedValue;

  useEffect(() => {
    if (!autoFocus) {
      return;
    }

    inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  return (
    <div
      ref={wrapperRef}
      // __field marks the component root so the core-CSS focus tint applies on
      // every surface (e.g. the generic storefront header), not just the navbar.
      className={cn(
        'ogabassey-navbar-search__field relative w-full',
        className
      )}
      role="combobox"
      aria-expanded={showPopup}
      aria-haspopup="listbox"
      aria-controls={showPopup && hasResults ? listboxId : undefined}
      aria-owns={showPopup && hasResults ? listboxId : undefined}
      aria-busy={loading}
      tabIndex={-1}
    >
      <div className="relative">
        {/* Geometry has TWO sources so the control is styled in every CSS
            context: (1) core CSS (.ogabassey-navbar-search__icon) — the
            route-independent source for storefront `source(none)` routes that do
            not @source this lazily-loaded component (PDP/content); (2) these
            Tailwind utilities — generated wherever the component IS sourced,
            including the platform template-preview (globals.css), which never
            loads storefront-core.css. The `-translate-y-1/2` centering uses the
            CSS `translate` property, the SAME one core CSS uses, so when both
            apply (e.g. the home route, which @sources this file) they collapse to
            one declaration instead of stacking into a double offset. The
            idle colour is `text-muted-foreground` (the no-core fallback); the
            core-CSS rules are UNLAYERED so the merchant-themed idle colour and
            the focus tint override it on storefront routes. Where core CSS is
            absent (the preview) the icon stays muted and the focus tint simply
            does not apply. */}
        <Search
          className="ogabassey-navbar-search__icon pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 size-5 z-20 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          ref={inputRef}
          type="search"
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            // Open eagerly for submit-wired consumers so the "See all
            // results" action stays reachable while the fetch is pending
            // and when it fails outright (touch users have no Enter key).
            if (onSubmitSearch && e.target.value.trim()) {
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (isPopupLength(value)) {
              setIsOpen(true);
            }
          }}
          className={cn(
            // Padding has TWO sources (see the icon comment): core CSS keyed on
            // `__field` / `__input--has-value` for storefront `source(none)`
            // routes, and these Tailwind utilities for contexts that source the
            // component but do not load core CSS (the platform template-preview).
            // Padding is non-additive, so both sources agree on every route.
            'pl-11 [&::-webkit-search-cancel-button]:appearance-none',
            value ? 'pr-10 ogabassey-navbar-search__input--has-value' : ''
          )}
          aria-autocomplete="list"
          aria-controls={showPopup && hasResults ? listboxId : undefined}
          aria-activedescendant={
            highlightedIndex >= 0
              ? `search-option-${highlightedIndex}`
              : undefined
          }
          aria-label="Search products"
          id={id}
          name={name}
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange('');
              setIsOpen(false);
              clearSuggestions();
              inputRef.current?.focus();
            }}
            // Geometry has TWO sources (see the icon comment): core CSS
            // (.ogabassey-navbar-search__clear) for storefront `source(none)`
            // routes, and these Tailwind utilities for contexts that source the
            // component but do not load core CSS (the platform template-preview).
            // `-translate-y-1/2` uses the `translate` property core CSS also
            // uses, so the two never stack into a double offset.
            className="ogabassey-navbar-search__clear absolute right-1 top-1/2 -translate-y-1/2 size-8 flex items-center justify-center z-20 text-muted-foreground hover:text-foreground focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Screen reader announcement for results */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {isOpen &&
          hasResults &&
          `${resultsCount} ${resultsCount === 1 ? 'result' : 'results'} available`}
        {isOpen && !hasResults && hasSuggestionsResponse && 'No results found'}
      </div>

      {showPopup && (
        <SearchAutocompletePopup
          canSubmitSearch={canSubmitSearch}
          formatCurrencyCompact={formatCurrencyCompact}
          hasResults={hasResults}
          hasSuggestionsResponse={hasSuggestionsResponse}
          highlightedIndex={highlightedIndex}
          listboxId={listboxId}
          loading={loading}
          onChange={onChange}
          onClose={() => setIsOpen(false)}
          onSelectProduct={onSelectProduct}
          onSubmitSearch={onSubmitSearch ?? (() => undefined)}
          popularSearches={popularSearches}
          suggestions={suggestions}
          trimmedValue={trimmedValue}
          value={value}
        />
      )}
    </div>
  );
}
