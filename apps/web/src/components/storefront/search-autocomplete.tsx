'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/use-debounce';
import { trackEvent } from '@/lib/event-tracking';
import { getProductUrl } from '@/lib/product-url';
import { recordSearchSubmission } from '@/lib/search-submission';
import { cn } from '@/lib/utils';
import {
  type AutocompleteProduct,
  type PopularSearch,
  SearchAutocompletePanel,
} from './search-autocomplete-panel';

export interface SearchAutocompleteProps {
  merchantId: string;
  searchPathPrefix?: string;
  value: string;
  onChange: (value: string) => void;
  onSelectProduct?: (url: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  name?: string;
  autoFocus?: boolean;
  countryCode?: string | null;
  payoutCurrency?: string | null;
}

export function SearchAutocomplete({
  merchantId,
  searchPathPrefix,
  value,
  onChange,
  onSelectProduct,
  placeholder = 'Search products...',
  className,
  id = 'search-input',
  name = 'q',
  autoFocus = false,
  countryCode,
  payoutCurrency,
}: SearchAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<AutocompleteProduct[]>([]);
  const [popularSearches, setPopularSearches] = useState<PopularSearch[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 200ms sits at the responsive end of the 200-400ms typeahead debounce range;
  // pairs with the per-request AbortController below so superseded queries cancel.
  const debouncedValue = useDebounce(value, 200);

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
      setLoading(false);
      setSuggestions([]);
      setPopularSearches([]);
      setIsOpen(false);
    }
  }

  // Clear stale results once the debounced query becomes too short, using the
  // same render-time prev-comparison pattern instead of an effect.
  const [prevDebouncedValue, setPrevDebouncedValue] = useState(debouncedValue);
  if (debouncedValue !== prevDebouncedValue) {
    setPrevDebouncedValue(debouncedValue);
    if (debouncedValue.length < 2) {
      setLoading(false);
      setSuggestions([]);
      setPopularSearches([]);
      setIsOpen(false);
    }
  }

  // Debounced search with autocomplete suggestions
  useEffect(() => {
    if (debouncedValue.length < 2) {
      return;
    }

    // Abort the request when this debounced query is superseded (cleanup runs on
    // the next debouncedValue) so a slow earlier query can never paint over newer
    // results and the server stops work it no longer needs. We deliberately do
    // NOT abort on every raw keystroke: that would cancel the in-flight request
    // without guaranteeing a replacement (e.g. type "iphones" then backspace to
    // "iphone" within the debounce window — debouncedValue never changes, so the
    // effect would not re-run and the dropdown would be left empty).
    const controller = new AbortController();
    let isMounted = true;
    setLoading(true);
    fetch(
      `/api/search/autocomplete?q=${encodeURIComponent(debouncedValue)}&merchant_id=${merchantId}&limit=10`,
      { signal: controller.signal }
    )
      .then((response) => response.json())
      .then(
        (data: {
          suggestions?: AutocompleteProduct[];
          popularSearches?: PopularSearch[];
        }) => {
          if (!isMounted) {
            return;
          }
          setSuggestions(data.suggestions || []);
          setPopularSearches(data.popularSearches || []);
          setIsOpen(true);
          setHighlightedIndex(-1);

          // Track search event for merchant analytics
          const resultsCount =
            (data.suggestions?.length || 0) +
            (data.popularSearches?.length || 0);
          trackEvent.search(merchantId, debouncedValue, resultsCount);
        }
      )
      .catch((error: unknown) => {
        // Ignore aborts from superseded keystrokes / unmount.
        if (controller.signal.aborted || !isMounted) {
          return;
        }
        console.error('Autocomplete error:', error);
        setSuggestions([]);
        setPopularSearches([]);
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [debouncedValue, merchantId]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const totalItems = suggestions.length + popularSearches.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      if (highlightedIndex < suggestions.length) {
        const product = suggestions[highlightedIndex];
        onSelectProduct?.(getProductUrl(product));
        setIsOpen(false);
      } else {
        const searchIndex = highlightedIndex - suggestions.length;
        const search = popularSearches[searchIndex];
        // Keyboard picks are explicit search actions too (see panel onClick).
        recordSearchSubmission(
          search.search_query,
          searchPathPrefix ?? '',
          'popular-search'
        );
        onChange(search.search_query);
        setIsOpen(false);
      }
    } else if (
      e.key === 'Enter' &&
      highlightedIndex < 0 &&
      suggestions.length > 0
    ) {
      e.preventDefault();
      onSelectProduct?.(getProductUrl(suggestions[0]));
      setIsOpen(false);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const hasResults = suggestions.length > 0 || popularSearches.length > 0;
  const listboxId = `search-listbox-${merchantId}`;
  const resultsCount = suggestions.length + popularSearches.length;
  // Single condition driving both the popup render and aria-expanded, so the
  // zero-result see-all footer is announced as expanded whenever visible.
  const isPopupOpen =
    isOpen &&
    (hasResults ||
      (searchPathPrefix !== undefined && value.trim().length >= 2));

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
      aria-expanded={isPopupOpen}
      aria-haspopup="listbox"
      aria-controls={listboxId}
      aria-owns={listboxId}
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
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => value.length >= 2 && setIsOpen(true)}
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
          aria-controls={listboxId}
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
              setSuggestions([]);
              setPopularSearches([]);
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
        {isOpen && !hasResults && value.length >= 2 && 'No results found'}
      </div>

      {isPopupOpen && (
        <SearchAutocompletePanel
          listboxId={listboxId}
          query={value}
          searchPathPrefix={searchPathPrefix}
          suggestions={suggestions}
          popularSearches={popularSearches}
          highlightedIndex={highlightedIndex}
          loading={loading}
          countryCode={countryCode}
          payoutCurrency={payoutCurrency}
          onSelectProduct={(url) => onSelectProduct?.(url)}
          onSelectPopularSearch={onChange}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
