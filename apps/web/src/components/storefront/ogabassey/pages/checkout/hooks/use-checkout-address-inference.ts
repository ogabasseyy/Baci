'use client';

import { useEffect, useRef } from 'react';
import type { useCheckoutFormState } from './use-checkout-form-state';

/** Debounce inferred city/state and cancel pending writes after explicit address selection or unmount. */
export function useCheckoutAddressInference(
  setFields: ReturnType<typeof useCheckoutFormState>['setValues']
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearInferredLocationDebounce = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const scheduleInferredLocationUpdate = ({
    city,
    state,
  }: {
    city: string;
    state: string;
  }) => {
    clearInferredLocationDebounce();
    timer.current = setTimeout(() => {
      setFields({ newAddressCity: city, newAddressState: state });
      timer.current = null;
    }, 500);
  };
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    []
  );
  return { clearInferredLocationDebounce, scheduleInferredLocationUpdate };
}
