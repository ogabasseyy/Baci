import { type MutableRefObject, useRef } from 'react';
import { Keyboard } from 'react-native';
import { fetchPlaceDetails } from './AddressAutocomplete.api';
import type {
  AddressAutocompleteProps,
  PlacePrediction,
} from './AddressAutocomplete.types';
import { applyPlaceSelection } from './apply-place-selection';

type PredictionSelectDeps = {
  isMountedRef: MutableRefObject<boolean>;
  latestQueryRef: MutableRefObject<string>;
  onChangeText: AddressAutocompleteProps['onChangeText'];
  onSelect: AddressAutocompleteProps['onSelect'];
  sessionToken: string;
  setInternalValue: (value: string) => void;
  setIsLoading: (value: boolean) => void;
  setPredictions: (value: PlacePrediction[]) => void;
  setSessionToken: (token: string) => void;
};

/**
 * Prediction-select handler: the suggestions-portal effect depends on its
 * identity. Stable by construction through a latest-values ref (same
 * pattern as use-savings-first-card-checkout): no manual useCallback
 * (prohibited in this repo) and no dependence on React Compiler
 * memoization, which is a performance optimization rather than a
 * semantic guarantee for this effect dependency.
 */
export function usePredictionSelectHandler({
  isMountedRef,
  latestQueryRef,
  onChangeText,
  onSelect,
  sessionToken,
  setInternalValue,
  setIsLoading,
  setPredictions,
  setSessionToken,
}: PredictionSelectDeps) {
  const latestRef = useRef({
    isMountedRef,
    latestQueryRef,
    onChangeText,
    onSelect,
    sessionToken,
    setInternalValue,
    setIsLoading,
    setPredictions,
    setSessionToken,
  });
  latestRef.current = {
    isMountedRef,
    latestQueryRef,
    onChangeText,
    onSelect,
    sessionToken,
    setInternalValue,
    setIsLoading,
    setPredictions,
    setSessionToken,
  };
  const stableRef = useRef<
    ((prediction: PlacePrediction) => Promise<void>) | null
  >(null);
  if (stableRef.current === null) {
    stableRef.current = async (prediction: PlacePrediction) => {
      const latest = latestRef.current;
      Keyboard.dismiss();
      latest.latestQueryRef.current = prediction.mainText;
      latest.setInternalValue(prediction.mainText);
      latest.onChangeText?.(prediction.mainText);
      latest.setPredictions([]);
      if (latest.isMountedRef.current) {
        latest.setIsLoading(true);
      }

      const details = await fetchPlaceDetails({
        prediction,
        sessionToken: latest.sessionToken,
      });
      applyPlaceSelection({
        details,
        isMountedRef: latest.isMountedRef,
        onSelect: latest.onSelect,
        setIsLoading: latest.setIsLoading,
        setPredictions: latest.setPredictions,
        setSessionToken: latest.setSessionToken,
      });
    };
  }
  return stableRef.current;
}
