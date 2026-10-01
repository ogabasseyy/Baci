import { useEffect, useRef, useState } from 'react';

/** Keep imperative provider reports and controlled form resets in sync. */
export function useAddressAutocompleteStatus(
  onError?: (failed: boolean) => void
) {
  const [suggestionsFailed, setSuggestionsFailed] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState(false);
  const lastReportedFailure = useRef(false);

  const handleProviderError = (failed: boolean) => {
    lastReportedFailure.current = failed;
    setSuggestionsFailed(failed);
    setPendingRecovery(false);
    onError?.(failed);
  };

  // Controlled prop synchronization clears local state during render. Notify
  // the parent after commit, never while rendering another component.
  useEffect(() => {
    if (pendingRecovery) {
      setPendingRecovery(false);
      if (lastReportedFailure.current) {
        lastReportedFailure.current = false;
        onError?.(false);
      }
    }
  }, [pendingRecovery, onError]);

  return {
    suggestionsFailed,
    handleProviderError,
    clearProviderError: () => {
      setSuggestionsFailed(false);
      setPendingRecovery(true);
    },
  };
}
