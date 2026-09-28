import { useEffect, useRef, useState } from 'react';
import { trackEvent } from '@/lib/event-tracking';
import type {
  AutocompletePopularSearch,
  AutocompleteProduct,
} from './search-autocomplete-types';

interface UseAutocompleteSuggestionsInput {
  debouncedValue: string;
  merchantId: string;
  /**
   * Runs after a fetch resolves with fresh results (open the popup, reset
   * the highlight). Read through a ref so the fetch effect only depends on
   * the debounced query and merchant.
   */
  onResultsReceived: () => void;
}

/**
 * Owns the debounced suggestion fetch: product suggestions, popular
 * searches, and the loading flag. Short queries never fetch; superseded
 * queries cancel via AbortController so a slow earlier query can never
 * paint over newer results.
 */
export function useAutocompleteSuggestions({
  debouncedValue,
  merchantId,
  onResultsReceived,
}: UseAutocompleteSuggestionsInput) {
  const [suggestions, setSuggestions] = useState<AutocompleteProduct[]>([]);
  const [popularSearches, setPopularSearches] = useState<
    AutocompletePopularSearch[]
  >([]);
  const [loading, setLoading] = useState(false);

  const onResultsRef = useRef(onResultsReceived);
  useEffect(() => {
    onResultsRef.current = onResultsReceived;
  });

  const clearSuggestions = () => {
    setLoading(false);
    setSuggestions([]);
    setPopularSearches([]);
  };

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
          popularSearches?: AutocompletePopularSearch[];
        }) => {
          if (!isMounted) {
            return;
          }
          setSuggestions(data.suggestions || []);
          setPopularSearches(data.popularSearches || []);
          onResultsRef.current();

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

  return { clearSuggestions, loading, popularSearches, suggestions };
}
