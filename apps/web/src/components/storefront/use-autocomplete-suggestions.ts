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
  // The debounced query whose fetch last resolved successfully. Gates the
  // "No suggestions" empty state so it appears only after a genuine empty
  // response — never during the debounce, while loading, or after a
  // failure (a failed request shows the submit action with no message).
  const [settledQuery, setSettledQuery] = useState<string | null>(null);

  const onResultsRef = useRef(onResultsReceived);
  useEffect(() => {
    onResultsRef.current = onResultsReceived;
  });

  // The currently in-flight request, if any, so dismissing the popup can
  // cancel it (see clearSuggestions).
  const inFlightControllerRef = useRef<AbortController | null>(null);

  const clearSuggestions = () => {
    // Abort the in-flight request so a late response can neither repaint
    // the cleared results nor reopen the popup via onResultsReceived.
    inFlightControllerRef.current?.abort();
    inFlightControllerRef.current = null;
    setLoading(false);
    setSuggestions([]);
    setPopularSearches([]);
    setSettledQuery(null);
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
    inFlightControllerRef.current = controller;
    let isMounted = true;
    setLoading(true);
    // A previous query may still be marked settled while this request is
    // pending (e.g. return to A after B failed and cleared the arrays).
    // Reset first so only this request's successful response can settle
    // the current query.
    setSettledQuery(null);
    fetch(
      `/api/search/autocomplete?q=${encodeURIComponent(debouncedValue)}&merchant_id=${merchantId}&limit=10`,
      { signal: controller.signal }
    )
      // The route returns JSON even for failures (e.g. a 500 body), which
      // would otherwise parse into empty arrays and settle the query as a
      // genuine "No suggestions" response. Reject first so failures take
      // the catch path and leave the query unsettled.
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Autocomplete request failed: ${response.status}`);
        }
        return response.json();
      })
      .then(
        (data: {
          suggestions?: AutocompleteProduct[];
          popularSearches?: AutocompletePopularSearch[];
        }) => {
          // Skip responses for requests cancelled by supersession, unmount,
          // or popup dismissal (clearSuggestions aborts the in-flight
          // request so it can neither repaint nor reopen the popup).
          if (!isMounted || controller.signal.aborted) {
            return;
          }
          setSuggestions(data.suggestions || []);
          setPopularSearches(data.popularSearches || []);
          setSettledQuery(debouncedValue);
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
      if (inFlightControllerRef.current === controller) {
        inFlightControllerRef.current = null;
      }
    };
  }, [debouncedValue, merchantId]);

  return {
    clearSuggestions,
    loading,
    popularSearches,
    settledQuery,
    suggestions,
  };
}
