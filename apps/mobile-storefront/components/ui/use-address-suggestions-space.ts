import { useEffect, useRef } from 'react';
import type { PlacePrediction } from './AddressAutocomplete.types';
import {
  addressSuggestionsScrollAmount,
  type SuggestionsRect,
} from './address-suggestions-position';

/** One bounded adjustment per result set, rather than chasing each scroll frame. */
export function useAddressSuggestionsSpace({
  predictions,
  anchor,
  host,
  keyboardTop,
  contentHeight,
  onRequestSpace,
}: {
  predictions?: PlacePrediction[];
  anchor?: SuggestionsRect;
  host: SuggestionsRect;
  keyboardTop: number | null;
  contentHeight: number;
  onRequestSpace?: (amount: number) => void;
}) {
  const requested = useRef<{
    predictions: PlacePrediction[];
    keyboardTop: number | null;
  } | null>(null);
  useEffect(() => {
    if (!predictions?.length) {
      requested.current = null;
      return;
    }
    if (!anchor || !contentHeight || !onRequestSpace) return;
    if (
      requested.current?.predictions === predictions &&
      requested.current.keyboardTop === keyboardTop
    )
      return;
    requested.current = { predictions, keyboardTop };
    const amount = addressSuggestionsScrollAmount(
      anchor,
      host,
      keyboardTop,
      contentHeight
    );
    if (amount > 1) onRequestSpace(amount);
  }, [predictions, anchor, host, keyboardTop, contentHeight, onRequestSpace]);
}
