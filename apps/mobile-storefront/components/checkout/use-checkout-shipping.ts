import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { fetchShippingQuotes } from '@/components/checkout/checkout-shipping.helpers';
import {
  getDefaultPickupQuoteId,
  getShippingQuoteMode,
} from '@/components/checkout/checkout-station-pickup';
import {
  findSelectedQuote,
  getDeliveryMethodFee,
  getShippingProviderForMethod as getProvider,
  getQuotePreference,
  requiresQuote,
} from '@/components/checkout/checkout-step-helpers';
import { buildShippingQuoteContextKey } from '@/lib/shipping-quotes';
import { applyCheckoutGoogleCitySuggestion } from './apply-checkout-google-city-suggestion';
import { useApplyDeliveryFallback } from './checkout-door-fallback';
import { createCheckoutShippingHandlers } from './checkout-shipping-handlers';
import { loadShippingStates } from './checkout-shipping-loaders';
import { getCheckoutLocationPickerVisibility } from './get-checkout-location-picker-visibility';
import type { DeliveryMethod, ShippingQuote } from './types';
import type {
  SavedDoorAddress,
  UseCheckoutShippingParams,
} from './use-checkout-shipping.types';
import { useCheckoutShippingCitiesEffect } from './use-checkout-shipping-cities-effect';
export function useCheckoutShipping({
  apiBaseUrl,
  customer,
  items,
  setValue,
  watchedAddress,
  watchedCity,
  watchedEmail,
  watchedFirstName,
  watchedLastName,
  watchedPhone,
  watchedState,
}: UseCheckoutShippingParams) {
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('door');
  const [shippingStates, setShippingStates] = useState<string[]>([]);
  const [shippingCities, setShippingCities] = useState<string[]>([]);
  const [shippingCitiesState, setShippingCitiesState] = useState('');
  const [shippingQuotes, setShippingQuotes] = useState<ShippingQuote[]>([]);
  const [selectedQuoteId, setSelectedQuoteId] = useState('');
  const [resolvedQuoteKey, setResolvedQuoteKey] = useState('');
  const [resolvedPreference, setResolvedPreference] = useState<
    '' | 'door' | 'pickup_station'
  >('');
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [isLoadingCities, setIsLoadingCities] = useState(Boolean(watchedState));
  const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);
  const [showStatePicker, setShowStatePicker] = useState(false);
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [citySearch, setCitySearch] = useState('');
  const [citySearchFocused, setCitySearchFocused] = useState(false);
  const [committedAddress, setCommittedAddress] = useState('');
  const [deliveryCoordinates, setDeliveryCoordinates] =
    useState<SavedDoorAddress['coordinates']>(null);
  const savedDoorAddressRef = useRef<SavedDoorAddress | null>(null);
  const googleSuggestedCityRef = useRef<string | null>(null);
  const shippingQuoteAbortRef = useRef<AbortController | null>(null);
  const currentShippingQuoteContextKey = buildShippingQuoteContextKey(
    watchedState,
    watchedCity,
    items,
    committedAddress
  );
  const activeDeliveryCoordinates =
    watchedAddress === committedAddress ? deliveryCoordinates : null;
  const {
    canUsePickupStation,
    currentQuotePreference,
    hasResolvedDeliveryLocation,
    isCurrentQuoteContext,
    stationPickupQuote,
    usesDoorQuotes,
    usesPickupQuotes,
    usesProviderPickup,
  } = getShippingQuoteMode({
    city: watchedCity,
    deliveryMethod,
    resolvedPreference,
    resolvedQuoteKey,
    shippingQuoteContextKey: currentShippingQuoteContextKey,
    shippingQuotes,
    state: watchedState,
  });
  useApplyDeliveryFallback({
    canUsePickupStation,
    deliveryMethod,
    hasResolvedDeliveryLocation,
    selectedQuoteId,
    setDeliveryMethod,
    setSelectedQuoteId,
    shippingQuotes,
    watchedCity,
    watchedState,
  });
  const resetQuotes = () => {
    setShippingQuotes([]);
    setSelectedQuoteId('');
    setResolvedQuoteKey('');
    setResolvedPreference('');
  };
  const requestShippingQuotes = (shouldResetSelection: boolean) => {
    const deliveryPreference = getQuotePreference(deliveryMethod);
    const controller = new AbortController();
    shippingQuoteAbortRef.current = controller;
    void fetchShippingQuotes({
      apiUrl: apiBaseUrl,
      state: watchedState,
      city: watchedCity,
      latitude: activeDeliveryCoordinates?.latitude,
      longitude: activeDeliveryCoordinates?.longitude,
      items,
      customer,
      watchedFirstName,
      watchedLastName,
      watchedPhone,
      watchedAddress,
      watchedEmail,
      deliveryPreference,
      setIsLoadingQuotes,
      setSelectedQuoteId: (quoteId) => {
        if (deliveryPreference === 'pickup_station' && shouldResetSelection) {
          setSelectedQuoteId(getDefaultPickupQuoteId(watchedState, quoteId));
          return;
        }
        setSelectedQuoteId(quoteId);
      },
      setResolvedShippingQuoteContextKey: (key) => {
        setResolvedQuoteKey(key);
        setResolvedPreference(key ? deliveryPreference : '');
      },
      setShippingQuotes,
      previousSelectedQuoteId: shouldResetSelection ? null : selectedQuoteId,
      quoteContextKey: currentShippingQuoteContextKey,
      shouldResetSelection,
      signal: controller.signal,
    }).catch(() => setIsLoadingQuotes(false));
  };
  const requestShippingQuotesFromEffect = useEffectEvent(
    (shouldResetSelection: boolean) => {
      requestShippingQuotes(shouldResetSelection);
    }
  );
  const applyGoogleSuggestedCity = useEffectEvent((cities: string[]) => {
    applyCheckoutGoogleCitySuggestion({
      cities,
      onClearSuggestion: () => {
        googleSuggestedCityRef.current = null;
      },
      onOpenPicker: () => setShowCityPicker(true),
      onSearchCity: setCitySearch,
      onSelectCity: (city) => setValue('city', city, { shouldValidate: true }),
      suggestedCity: googleSuggestedCityRef.current,
    });
  });
  const [prevCityRequest, setPrevCityRequest] = useState(() => ({
    apiBaseUrl,
    watchedState,
  }));
  if (
    prevCityRequest.apiBaseUrl !== apiBaseUrl ||
    prevCityRequest.watchedState !== watchedState
  ) {
    setPrevCityRequest({ apiBaseUrl, watchedState });
    setShippingCities([]);
    setShippingCitiesState('');
    setIsLoadingCities(Boolean(watchedState));
    if (!watchedState) resetQuotes();
  }
  const quotesSuspendReason = watchedState && watchedCity ? null : 'address';
  const [prevQuotesSuspendReason, setPrevQuotesSuspendReason] =
    useState(quotesSuspendReason);
  if (prevQuotesSuspendReason !== quotesSuspendReason) {
    setPrevQuotesSuspendReason(quotesSuspendReason);
    if (quotesSuspendReason !== null && deliveryMethod !== 'airport') {
      resetQuotes();
    }
  }
  useEffect(() => {
    loadShippingStates({
      apiBaseUrl,
      setIsLoadingLocations,
      setShippingStates,
    });
  }, [apiBaseUrl]);
  useCheckoutShippingCitiesEffect({
    apiBaseUrl,
    onCitiesLoaded: (cities) => {
      setShippingCitiesState(watchedState);
      applyGoogleSuggestedCity(cities);
    },
    onCitiesUnavailable: () => {
      setShippingCitiesState(watchedState);
      applyGoogleSuggestedCity([]);
    },
    setIsLoadingCities,
    setShippingCities,
    state: watchedState,
  });
  useEffect(() => {
    shippingQuoteAbortRef.current?.abort();
    if (
      (!usesDoorQuotes && !usesPickupQuotes) ||
      !watchedState ||
      !watchedCity ||
      isCurrentQuoteContext
    ) {
      shippingQuoteAbortRef.current = null;
      return;
    }
    requestShippingQuotesFromEffect(
      resolvedQuoteKey !== currentShippingQuoteContextKey ||
        resolvedPreference !== currentQuotePreference
    );
    return () => shippingQuoteAbortRef.current?.abort();
  }, [
    currentShippingQuoteContextKey,
    currentQuotePreference,
    isCurrentQuoteContext,
    resolvedQuoteKey,
    resolvedPreference,
    usesDoorQuotes,
    usesPickupQuotes,
    watchedCity,
    watchedState,
  ]);
  const selectedQuote = findSelectedQuote(shippingQuotes, selectedQuoteId);
  const deliveryFee = getDeliveryMethodFee(deliveryMethod, selectedQuote);
  const requiresShippingQuote =
    Boolean(currentShippingQuoteContextKey) &&
    requiresQuote(deliveryMethod, selectedQuote, usesProviderPickup);
  const handlers = createCheckoutShippingHandlers({
    committedAddress,
    currentShippingQuoteContextKey,
    deliveryCoordinates,
    deliveryMethod,
    googleSuggestedCityRef,
    requestShippingQuotes,
    resolvedShippingQuoteContextKey: resolvedQuoteKey,
    savedDoorAddressRef,
    setCitySearch,
    setCommittedAddress,
    setDeliveryCoordinates,
    setDeliveryMethod,
    setResolvedShippingQuoteContextKey: setResolvedQuoteKey,
    setSelectedQuoteId,
    setShowCityPicker,
    setShowStatePicker,
    setValue,
    quoteSelection: { selectedQuoteId, shippingQuotes },
    shippingQuoteAbortRef,
    shippingStates,
    shippingCities,
    shippingCitiesState,
    stationPickupQuote,
    watchedAddress,
    watchedCity,
    watchedState,
  });
  return {
    citySearch,
    citySearchFocused,
    currentShippingQuoteContextKey,
    deliveryFee,
    deliveryMethod,
    getShippingProvider: () => getProvider(deliveryMethod, selectedQuote),
    ...handlers,
    isLoadingCities,
    isLoadingLocations,
    isLoadingQuotes,
    isCurrentQuoteContext,
    resolvedShippingQuoteContextKey: resolvedQuoteKey,
    requiresShippingQuote,
    selectedQuote,
    selectedQuoteId,
    setCitySearch,
    setCitySearchFocused,
    setCommittedAddress,
    setSelectedQuoteId,
    setShowCityPicker,
    setShowStatePicker,
    shippingCities,
    shippingQuotes,
    shippingStates,
    showLocationPickers: getCheckoutLocationPickerVisibility(
      watchedAddress,
      watchedCity,
      Boolean(activeDeliveryCoordinates),
      deliveryMethod === 'pickup_station',
      watchedState
    ),
    showCityPicker,
    showStatePicker,
  };
}
