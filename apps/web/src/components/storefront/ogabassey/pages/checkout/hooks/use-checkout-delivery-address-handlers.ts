'use client';

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
  resetQuotesForAddressChange,
  scheduleInferredLocationUpdate,
  setFields,
  setIsNewAddressMode,
  setNewAddressCity,
  setNewAddressState,
  setSelectedAddressId,
  shippingStates,
}: UseCheckoutDeliveryAddressHandlersOptions) {
  const onSelectAddress = (address: SavedCheckoutAddress) => {
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
      resetQuotesForAddressChange();
      scheduleInferredLocationUpdate(inferred);
      return;
    }

    clearInferredLocationDebounce();
    setFields({ newAddressCity: '', newAddressState: '' });
    resetQuotesForAddressChange();
  };

  const onSelectPlace = (place: PlaceDetails) => {
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

  return { onSelectAddress, onSelectPlace, onStreetChange };
}
