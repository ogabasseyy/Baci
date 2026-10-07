import { type MutableRefObject, useCallback } from 'react';
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
 * Stable prediction-select handler: the suggestions-portal effect depends
 * on its identity, so an inline closure would re-run the portal on every
 * render.
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
  return useCallback(
    async (prediction: PlacePrediction) => {
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
    },
    // Refs and state setters are stable at the call site, so only the
    // callbacks and session token can retrigger this handler.
    [
      isMountedRef,
      latestQueryRef,
      onChangeText,
      onSelect,
      sessionToken,
      setInternalValue,
      setIsLoading,
      setPredictions,
      setSessionToken,
    ]
  );
}
