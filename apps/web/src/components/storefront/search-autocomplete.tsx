'use client';

import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useCurrencyWithCountry } from '@/hooks/use-currency';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { SearchAutocompleteClearButton } from './search-autocomplete-clear-button';
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
  maxLength,
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
  // Set by navigation-closing submissions (full-search submit, product
  // select): the submitted value can reach the debounce after navigation
  // and start a request that did not exist when the pending one was
  // cancelled — its results must not reopen the popup over the
  // destination page. Cleared when the shopper focuses or edits again.
  const suppressReopenRef = useRef(false);
  // Restarted-request generation (see the render-time restore detection
  // below): reissues a request aborted by transient short input when the
  // same fetchable query comes back within the debounce window.
  const [refetchToken, setRefetchToken] = useState(0);
  // The fetchable debounced query whose request the short-input reset most
  // recently aborted (if any). Survives multi-keystroke restorations
  // ("i" -> "ip" -> ... -> "iphone") that never reproduce the original
  // transition in a single step; cleared once the query is restored or the
  // debounced value moves on (a normal fetch then takes over).
  const [clearedQuery, setClearedQuery] = useState<string | null>(null);
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
      setHighlightedIndex(-1);
      if (!suppressReopenRef.current) {
        setIsOpen(true);
      }
    },
    refetchToken,
  });

  // Navigation-closing activations (full-search submit, product select)
  // also cancel the pending suggestion request and suppress result-driven
  // reopening: persistent consumers (e.g. the navbar) stay mounted across
  // the navigation, and both a late in-flight response and a fresh
  // post-submit debounce request (after the submitted value syncs back
  // into the input) would otherwise reopen the popup over the destination
  // page via onResultsReceived. Dismissals (Escape, outside click) keep
  // close-only behavior so refocusing restores the retained results.
  const handleSelectProduct = (url: string) => {
    suppressReopenRef.current = true;
    clearSuggestions();
    onSelectProduct?.(url);
  };
  const handleSubmitSearch = onSubmitSearch
    ? (query: string) => {
        suppressReopenRef.current = true;
        clearSuggestions();
        onSubmitSearch(query);
      }
    : undefined;

  const handleKeyDown = createAutocompleteKeyDownHandler({
    highlightedIndex,
    onChange,
    onClose: () => setIsOpen(false),
    onHighlight: setHighlightedIndex,
    onSelectProduct: handleSelectProduct,
    onSubmitSearch: handleSubmitSearch,
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
      // Remember which fetchable query lost its request (if any) so its
      // restoration can restart it (see below).
      setClearedQuery(debouncedValue.length >= 2 ? debouncedValue : null);
      if (!isPopupLength(value)) {
        setIsOpen(false);
      }
    } else if (
      clearedQuery !== null &&
      value === debouncedValue &&
      debouncedValue === clearedQuery
    ) {
      // Restoring the query aborted above ("iphone" -> "i" -> "iphone",
      // directly or over several keystrokes within the debounce window):
      // the debounced value never changed, so restart the request
      // explicitly. Unrelated typing never matches — the value must equal
      // both the live debounced query and the recorded cleared one — so
      // this fires only on a genuine restore. The highlight is already
      // clear from the short-input reset above.
      setRefetchToken((token) => token + 1);
      setClearedQuery(null);
    } else {
      // Any other external value change (e.g. the navbar route sync
      // replacing the query after a did-you-mean navigation) bypasses the
      // input's keystroke reset: the highlight still belongs to the
      // previous text's options, so drop it. Retained options stay visible
      // until the new fetch resolves, matching live-update typing.
      setHighlightedIndex(-1);
    }
  }

  // Clear stale results once the debounced query becomes too short, using the
  // same render-time prev-comparison pattern instead of an effect.
  const [prevDebouncedValue, setPrevDebouncedValue] = useState(debouncedValue);
  if (debouncedValue !== prevDebouncedValue) {
    setPrevDebouncedValue(debouncedValue);
    // The debounced query moved on, so a normal fetch takes over: any
    // recorded cleared query is stale (its restoration window closed).
    setClearedQuery(null);
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
  // failure. The settled query must match the RAW input, not just the
  // debounced one: after A settles empty, typing B leaves debouncedValue
  // on A for 200ms, and comparing against it would report "No
  // suggestions" for B before B is even requested. Queries that never
  // fetch (e.g. one character) stay silent.
  const hasSuggestionsResponse = settledQuery === value;

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
      // Expansion refers to the listbox popup specifically: when only the
      // standalone "See all results" action is visible (one-character
      // query, failed request, or genuinely empty response), no listbox
      // exists in the DOM, so reporting expanded would send screen
      // readers looking for a suggestion list that is absent. The action
      // itself is a native button right after the input in DOM order, so
      // it stays keyboard and screen-reader discoverable either way.
      aria-expanded={showPopup && hasResults}
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
          maxLength={maxLength}
          value={value}
          onChange={(e) => {
            // A genuine edit re-arms result-driven opening after a
            // navigation-closing submission suppressed it.
            suppressReopenRef.current = false;
            const nextValue = e.target.value;
            // When the popup is closed (dismissed via Escape or an outside
            // click), the retained arrays still belong to the previous
            // query: drop them so the reopened popup cannot offer stale
            // options beneath the new text. While open, the previous
            // results stay visible until the new fetch resolves (standard
            // live-update typeahead). isOpen here is the pre-update state.
            if (!isOpen && nextValue.length >= 2) {
              clearSuggestions();
            }
            // A highlight always belongs to the previous text's options:
            // reset on every keystroke so Enter can never follow a stale
            // option for the old query while the new fetch is pending.
            setHighlightedIndex(-1);
            onChange(nextValue);
            // Open eagerly for submit-wired consumers so the "See all
            // results" action stays reachable while the fetch is pending
            // and when it fails outright (touch users have no Enter key).
            if (onSubmitSearch && nextValue.trim()) {
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            // Refocusing re-arms result-driven opening (and restores any
            // retained results) after a navigation-closing submission.
            suppressReopenRef.current = false;
            if (isPopupLength(value)) {
              setIsOpen(true);
            }
            // A navigation-closing submit clears settled results without
            // changing the debounced query, so focusing the unchanged input
            // afterwards (back navigation, persistent results-page navbar)
            // must refetch them. Only when the debounce has settled on the
            // current value — a mismatched debounce means a newer query is
            // already on its way — nothing is in flight, and no fresh
            // response is stored.
            if (
              value.length >= 2 &&
              value === debouncedValue &&
              !loading &&
              settledQuery !== debouncedValue
            ) {
              setRefetchToken((token) => token + 1);
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
          <SearchAutocompleteClearButton
            onClear={() => {
              onChange('');
              setIsOpen(false);
              clearSuggestions();
              inputRef.current?.focus();
            }}
          />
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
          onSelectProduct={handleSelectProduct}
          onSubmitSearch={handleSubmitSearch ?? (() => undefined)}
          popularSearches={popularSearches}
          suggestions={suggestions}
          trimmedValue={trimmedValue}
          value={value}
        />
      )}
    </div>
  );
}
