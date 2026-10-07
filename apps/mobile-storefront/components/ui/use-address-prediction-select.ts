import type { MutableRefObject } from 'react';
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
 * identity. No manual useCallback — React Compiler memoizes this closure
 * (manual memoization hooks are prohibited in this repo).
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
  return async (prediction: PlacePrediction) => {
    Keyboard.dismiss();
    latestQueryRef.current = prediction.mainText;
    setInternalValue(prediction.mainText);
    onChangeText?.(prediction.mainText);
    setPredictions([]);
    if (isMountedRef.current) {
      setIsLoading(true);
    }

    const details = await fetchPlaceDetails({ prediction, sessionToken });
    applyPlaceSelection({
      details,
      isMountedRef,
      onSelect,
      setIsLoading,
      setPredictions,
      setSessionToken,
    });
  };
}
