'use client';

import { useRef } from 'react';
import type { PlaceDetails } from '@/components/address-autocomplete';
import type { SavedCheckoutAddress } from '../components/DeliveryAddressFields';
import { inferAddressLocationFromInput } from '../utils';
import type { useCheckoutFormState } from './use-checkout-form-state';

type CheckoutFormSetFields = ReturnType<
  typeof useCheckoutFormState
>['setValues'];

interface UseCheckoutDeliveryAddressHandlersOptions {
  clearInferredLocationDebounce: () => void;
  merchantCountry: string;
  newAddressCity?: string;
  newAddressState?: string;
  resetQuotesForAddressChange: () => void;
  scheduleInferredLocationUpdate: (location: {
    city: string;
    state: string;
  }) => void;
  setFields: CheckoutFormSetFields;
  setIsNewAddressMode: (value: boolean) => void;
  setNewAddressCity: (value: string) => void;
  setNewAddressState: (value: string) => void;
  setSelectedAddressId: (value: number) => void;
  shippingStates: string[];
}

/** Keeps address edits, inferred location and shipping quote invalidation together. */
export function useCheckoutDeliveryAddressHandlers({
  clearInferredLocationDebounce,
  merchantCountry,
  newAddressCity = '',
  newAddressState = '',
  resetQuotesForAddressChange,
  scheduleInferredLocationUpdate,
  setFields,
  setIsNewAddressMode,
  setNewAddressCity,
  setNewAddressState,
  setSelectedAddressId,
  shippingStates,
}: UseCheckoutDeliveryAddressHandlersOptions) {
  const manualLocality = useRef(false);
  const replaceableLocality = useRef(false);
  const onSelectAddress = (address: SavedCheckoutAddress) => {
    manualLocality.current = false;
    replaceableLocality.current = true;
    setSelectedAddressId(address.id);
    setIsNewAddressMode(false);
    clearInferredLocationDebounce();
    resetQuotesForAddressChange();

    const parts = address.address.split(',').map((part) => part.trim());
    if (parts.length >= 2) {
      setNewAddressState(parts[parts.length - 1] || '');
      setNewAddressCity(parts[parts.length - 2] || '');
    }
  };

  const onStreetChange = (street: string) => {
    // Explicit locality fields remain authoritative while correcting the street.
    // A cleared address starts a fresh destination, including its locality.
    if (
      street.trim() &&
      (manualLocality.current ||
        (!replaceableLocality.current &&
          (newAddressCity.trim() || newAddressState.trim())))
    ) {
      clearInferredLocationDebounce();
      resetQuotesForAddressChange();
      setFields({ newAddressStreet: street, deliveryCoordinates: null });
      return;
    }
    manualLocality.current = false;
    replaceableLocality.current = false;
    setFields({
      newAddressStreet: street,
      newAddressCity: '',
      newAddressState: '',
      deliveryCoordinates: null,
    });

    if (!street || street.length < 10) {
      clearInferredLocationDebounce();
      setNewAddressState('');
      setNewAddressCity('');
      resetQuotesForAddressChange();
      return;
    }

    const inferred = inferAddressLocationFromInput(
      street,
      shippingStates,
      merchantCountry
    );
    if (inferred) {
      replaceableLocality.current = true;
      resetQuotesForAddressChange();
      scheduleInferredLocationUpdate(inferred);
      return;
    }

    clearInferredLocationDebounce();
    setFields({ newAddressCity: '', newAddressState: '' });
    resetQuotesForAddressChange();
  };

  const onSelectPlace = (place: PlaceDetails) => {
    manualLocality.current = false;
    replaceableLocality.current = true;
    clearInferredLocationDebounce();
    resetQuotesForAddressChange();
    setFields({
      newAddressStreet: place.formattedAddress,
      newAddressState: place.state || '',
      newAddressCity: place.city || '',
      deliveryCoordinates:
        Number.isFinite(place.location?.latitude) &&
        Number.isFinite(place.location?.longitude)
          ? {
              latitude: place.location?.latitude ?? 0,
              longitude: place.location?.longitude ?? 0,
            }
          : null,
    });
  };

  const onCityChange = (city: string) => {
    manualLocality.current = true;
    replaceableLocality.current = false;
    clearInferredLocationDebounce();
    resetQuotesForAddressChange();
    setFields({ newAddressCity: city, deliveryCoordinates: null });
  };
  const onStateChange = (state: string) => {
    manualLocality.current = true;
    replaceableLocality.current = false;
    clearInferredLocationDebounce();
    resetQuotesForAddressChange();
    setFields({ newAddressState: state, deliveryCoordinates: null });
  };

  return {
    onSelectAddress,
    onSelectPlace,
    onStreetChange,
    onCityChange,
    onStateChange,
  };
}
