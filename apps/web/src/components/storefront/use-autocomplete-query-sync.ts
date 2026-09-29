import { useRef, useState } from 'react';
import { useDebounce } from '@/hooks/use-debounce';
import { useAutocompleteSuggestions } from './use-autocomplete-suggestions';

interface UseAutocompleteQuerySyncInput {
  /** Live input value (controlled by the consumer). */
  value: string;
  merchantId: string;
  /** Pre-update popup state for the input handlers. */
  isOpen: boolean;
  /** Whether full-search submission is wired (eager popup open on edit). */
  canEagerOpen: boolean;
  /** Popup length gate, following the consumer contract. */
  isPopupLength: (text: string) => boolean;
  onChange: (value: string) => void;
  onHighlightReset: () => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * Owns the autocomplete's query/request orchestration: the debounced
 * suggestion fetch, the render-time value/debounce synchronization (short
 * resets, restoration restarts, external-change drops), and the input
 * event handlers. The component keeps popup/highlight state, keyboard
 * handling, effects, and rendering.
 */
export function useAutocompleteQuerySync({
  value,
  merchantId,
  isOpen,
  canEagerOpen,
  isPopupLength,
  onChange,
  onHighlightReset,
  onOpenChange,
}: UseAutocompleteQuerySyncInput) {
  // The value produced by the latest keystroke in this input (if the parent
  // applied it), so the render-time adjustment below can tell live-update
  // typing (keep old options until the new fetch resolves) from external
  // replacements (wholesale context switch: drop them). Keyed by value —
  // never a bare flag — so an unapplied keystroke cannot misclassify a
  // later external change.
  const keystrokeValueRef = useRef<string | null>(null);
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
  // 200ms sits at the responsive end of the 200-400ms typeahead debounce range;
  // pairs with the per-request AbortController below so superseded queries cancel.
  const debouncedValue = useDebounce(value, 200);

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
      onHighlightReset();
      if (!suppressReopenRef.current) {
        onOpenChange(true);
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
  const prepareNavigation = () => {
    suppressReopenRef.current = true;
    clearSuggestions();
  };

  // Immediately clear suggestions when value becomes too short.
  // Adjusted inline during render with a prev-prop comparison so users never
  // see a stale committed frame between the prop change and the reset.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    const fromKeystroke = keystrokeValueRef.current === value;
    keystrokeValueRef.current = null;
    setPrevValue(value);
    if (value.length < 2) {
      clearSuggestions();
      // The highlight must not outlive its options: the submit popup can
      // stay open for a one-character query after the arrays clear.
      onHighlightReset();
      // Remember which fetchable query lost its request (if any) so its
      // restoration can restart it (see below).
      setClearedQuery(debouncedValue.length >= 2 ? debouncedValue : null);
      if (!isPopupLength(value)) {
        onOpenChange(false);
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
    } else if (!fromKeystroke) {
      // An external value change (e.g. the navbar route sync replacing the
      // query after a did-you-mean navigation) bypasses the input's
      // keystroke path: the stored options and highlight still belong to
      // the previous query, so drop them entirely — a navigation is a
      // wholesale context switch, and leaving the old options
      // pointer-active would navigate to a product unrelated to the new
      // query. Keystroke-driven changes keep live-update behavior (the
      // handler above already reset the highlight). The debounce fetch for
      // the new value repopulates immediately after.
      clearSuggestions();
      onHighlightReset();
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
      onHighlightReset();
      if (!isPopupLength(debouncedValue)) {
        onOpenChange(false);
      }
    }
  }

  const handleInputChange = (nextValue: string) => {
    // A genuine edit re-arms result-driven opening after a
    // navigation-closing submission suppressed it.
    suppressReopenRef.current = false;
    keystrokeValueRef.current = nextValue;
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
    onHighlightReset();
    onChange(nextValue);
    // Open eagerly for submit-wired consumers so the "See all
    // results" action stays reachable while the fetch is pending
    // and when it fails outright (touch users have no Enter key).
    if (canEagerOpen && nextValue.trim()) {
      onOpenChange(true);
    }
  };

  const handleInputFocus = () => {
    // Refocusing re-arms result-driven opening (and restores any
    // retained results) after a navigation-closing submission.
    suppressReopenRef.current = false;
    if (isPopupLength(value)) {
      onOpenChange(true);
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
  };

  return {
    clearSuggestions,
    handleInputChange,
    handleInputFocus,
    loading,
    popularSearches,
    prepareNavigation,
    settledQuery,
    suggestions,
  };
}
