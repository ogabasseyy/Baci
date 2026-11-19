import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PlacePrediction } from '@/lib/google-places';

interface RequestOptions {
  selectionRevision: number;
  setPredictions: (predictions: PlacePrediction[]) => void;
  setIsOpen: (open: boolean) => void;
  setIsLoading: (loading: boolean) => void;
}

/** Invalidate requests only when the corresponding address change commits. */
export function useAddressAutocompleteRequests({
  selectionRevision,
  setPredictions,
  setIsOpen,
  setIsLoading,
}: RequestOptions) {
  const debounceTimer = useRef<NodeJS.Timeout | number | null>(null);
  const predictionRequestId = useRef(0);
  const placeDetailsRequestId = useRef(0);
  const [controlledReset, setControlledReset] = useState(0);
  const committedReset = useRef({ selectionRevision, controlledReset });

  // A suspended/abandoned render must not invalidate the visible address.
  useLayoutEffect(() => {
    if (
      committedReset.current.selectionRevision === selectionRevision &&
      committedReset.current.controlledReset === controlledReset
    )
      return;
    committedReset.current = { selectionRevision, controlledReset };
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    predictionRequestId.current += 1;
    placeDetailsRequestId.current += 1;
    setPredictions([]);
    setIsOpen(false);
    setIsLoading(false);
  }, [
    selectionRevision,
    controlledReset,
    setPredictions,
    setIsOpen,
    setIsLoading,
  ]);

  useEffect(
    () => () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      predictionRequestId.current += 1;
      placeDetailsRequestId.current += 1;
    },
    []
  );

  return {
    debounceTimer,
    predictionRequestId,
    placeDetailsRequestId,
    setControlledReset,
  };
}
