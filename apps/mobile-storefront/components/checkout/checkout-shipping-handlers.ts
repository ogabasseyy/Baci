import { isAirportDeliveryEligible } from '@baci/shared';
import type { RefObject } from 'react';
import type { UseFormSetValue } from 'react-hook-form';
import { normalizeStateName } from '@/components/checkout/checkout-shipping.helpers';
import { getDefaultPickupQuoteId } from '@/components/checkout/checkout-station-pickup';
import {
  AIRPORT_QUOTE_ID,
  isGiglGoFasterQuote,
  resolveDoorDeliveryQuoteId,
} from '@/components/checkout/checkout-step-helpers';
import type {
  DeliveryMethod,
  ShippingQuote,
} from '@/components/checkout/types';
import type { PlaceDetails } from '@/components/ui/AddressAutocomplete';
import type { ShippingAddressInput } from '@/lib/validation';
import type { SavedDoorAddress } from './use-checkout-shipping.types';

interface CreateCheckoutShippingHandlersParams {
  committedAddress: string;
  currentShippingQuoteContextKey: string;
  deliveryCoordinates: { latitude: number; longitude: number } | null;
  deliveryMethod: DeliveryMethod;
  requestShippingQuotes: (shouldResetSelection: boolean) => void;
  resolvedShippingQuoteContextKey: string;
  savedDoorAddressRef: RefObject<SavedDoorAddress | null>;
  setCitySearch: (value: string) => void;
  setCommittedAddress: (value: string) => void;
  setDeliveryCoordinates: (
    value: { latitude: number; longitude: number } | null
  ) => void;
  setDeliveryMethod: (value: DeliveryMethod) => void;
  setResolvedShippingQuoteContextKey: (value: string) => void;
  setSelectedQuoteId: (value: string) => void;
  setShowCityPicker: (value: boolean) => void;
  setShowStatePicker: (value: boolean) => void;
  setValue: UseFormSetValue<ShippingAddressInput>;
  quoteSelection: {
    selectedQuoteId?: string;
    shippingQuotes: ShippingQuote[];
  };
  shippingQuoteAbortRef: RefObject<AbortController | null>;
  shippingStates: string[];
  shippingCities?: string[];
  shippingCitiesState?: string;
  watchedAddress: string;
  watchedCity: string;
  watchedState: string;
  googleSuggestedCityRef: RefObject<string | null>;
  stationPickupQuote?: ShippingQuote;
}

export function createCheckoutShippingHandlers({
  committedAddress,
  currentShippingQuoteContextKey,
  deliveryCoordinates,
  deliveryMethod,
  googleSuggestedCityRef,
  requestShippingQuotes,
  resolvedShippingQuoteContextKey,
  savedDoorAddressRef,
  setCitySearch,
  setCommittedAddress,
  setDeliveryCoordinates,
  setDeliveryMethod,
  setResolvedShippingQuoteContextKey,
  setSelectedQuoteId,
  setShowCityPicker,
  setShowStatePicker,
  setValue,
  quoteSelection: { selectedQuoteId, shippingQuotes },
  shippingQuoteAbortRef,
  shippingStates,
  shippingCities = [],
  shippingCitiesState = '',
  watchedAddress,
  watchedCity,
  watchedState,
  stationPickupQuote,
}: CreateCheckoutShippingHandlersParams) {
  return {
    handleDeliveryAddressSelect: (
      place: PlaceDetails,
      updateAddress: (value: string) => void
    ) => {
      const selectedAddress = place.formattedAddress || '';
      updateAddress(selectedAddress);
      setCommittedAddress(selectedAddress);
      const hasGoogleCoordinates =
        Number.isFinite(place.latitude) && Number.isFinite(place.longitude);
      setDeliveryCoordinates(
        hasGoogleCoordinates
          ? {
              latitude: place.latitude as number,
              longitude: place.longitude as number,
            }
          : null
      );
      const normalizedState = place.state
        ? normalizeStateName(place.state, shippingStates)
        : '';
      const selectedCity = place.city?.trim() ?? '';
      const cityNeedsLoadedListValidation = Boolean(
        normalizedState &&
          selectedCity &&
          normalizedState.toLowerCase() === selectedCity.toLowerCase() &&
          shippingCitiesState.toLowerCase() !== normalizedState.toLowerCase()
      );
      const isAmbiguousGoogleCity = Boolean(
        normalizedState &&
          selectedCity &&
          !cityNeedsLoadedListValidation &&
          normalizedState.toLowerCase() === selectedCity.toLowerCase() &&
          shippingCitiesState.toLowerCase() === normalizedState.toLowerCase() &&
          shippingCities.length > 0 &&
          !shippingCities.some(
            (city) => city.toLowerCase() === selectedCity.toLowerCase()
          )
      );
      const hasCompleteGoogleLocation = Boolean(
        hasGoogleCoordinates &&
          normalizedState &&
          selectedCity &&
          !cityNeedsLoadedListValidation &&
          !isAmbiguousGoogleCity
      );

      if (hasCompleteGoogleLocation) {
        googleSuggestedCityRef.current = null;
      } else if (selectedCity) {
        googleSuggestedCityRef.current = isAmbiguousGoogleCity
          ? ''
          : selectedCity;
        if (isAmbiguousGoogleCity) {
          setCitySearch('');
          setShowCityPicker(true);
        }
      } else {
        googleSuggestedCityRef.current = normalizedState ? '' : null;
        if (normalizedState) {
          setCitySearch('');
          setShowCityPicker(true);
        }
      }

      setValue('city', hasCompleteGoogleLocation ? selectedCity : '', {
        shouldValidate: hasCompleteGoogleLocation,
      });
      if (normalizedState) {
        setValue('state', normalizedState, { shouldValidate: true });
      }
    },
    handleDeliveryAddressTextChange: (
      text: string,
      updateAddress: (value: string) => void
    ) => {
      updateAddress(text);
      if (committedAddress) setResolvedShippingQuoteContextKey('');
      setCommittedAddress('');
      setDeliveryCoordinates(null);
    },
    handleRetryShippingQuotes: () => {
      if (!watchedState || !watchedCity) return;
      if (shippingQuoteAbortRef.current) shippingQuoteAbortRef.current.abort();
      requestShippingQuotes(
        resolvedShippingQuoteContextKey !== currentShippingQuoteContextKey
      );
    },
    handleSelectCity: (city: string) => {
      setDeliveryCoordinates(null);
      setValue('city', city, { shouldValidate: true });
      setShowCityPicker(false);
      setCitySearch('');
    },
    handleSelectDeliveryMethod: (method: DeliveryMethod) => {
      if (method === 'pickup_station' && deliveryMethod !== 'pickup_station') {
        savedDoorAddressRef.current = {
          address: watchedAddress,
          city: watchedCity,
          coordinates: deliveryCoordinates,
          state: watchedState,
        };
      } else if (
        method !== 'pickup_station' &&
        deliveryMethod === 'pickup_station'
      ) {
        const saved = savedDoorAddressRef.current;
        if (saved) {
          setValue('address', saved.address, { shouldValidate: false });
          setValue('city', saved.city, { shouldValidate: false });
          setValue('state', saved.state, { shouldValidate: false });
          setCommittedAddress(saved.address);
          setDeliveryCoordinates(saved.coordinates);
          savedDoorAddressRef.current = null;
        }
        setSelectedQuoteId('');
      }
      if (method === 'pickup_station') {
        setSelectedQuoteId(
          getDefaultPickupQuoteId(
            watchedState,
            stationPickupQuote ? String(stationPickupQuote.id) : ''
          )
        );
      } else if (method === 'airport') {
        const selectedQuote = shippingQuotes.find(
          (quote) => String(quote.id) === String(selectedQuoteId)
        );
        const goFasterQuote = shippingQuotes.find(isGiglGoFasterQuote);
        setSelectedQuoteId(
          selectedQuote && isGiglGoFasterQuote(selectedQuote)
            ? String(selectedQuote.id)
            : !isAirportDeliveryEligible(watchedState) && goFasterQuote
              ? String(goFasterQuote.id)
              : AIRPORT_QUOTE_ID
        );
      } else if (method === 'door') {
        setSelectedQuoteId(
          resolveDoorDeliveryQuoteId(shippingQuotes, selectedQuoteId)
        );
      }
      setDeliveryMethod(method);
    },
    handleSelectState: (state: string) => {
      setDeliveryCoordinates(null);
      setValue('state', state, { shouldValidate: true });
      setValue('city', '', { shouldValidate: true });
      setShowStatePicker(false);
    },
  };
}
