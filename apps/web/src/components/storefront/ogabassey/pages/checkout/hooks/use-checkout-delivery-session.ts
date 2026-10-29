'use client';

import { useEffect, useState } from 'react';
import { loadShippingStates } from '../checkout-page-data-loaders';
import { isAirportDeliveryReady } from '../is-airport-delivery-ready';
import { resolveMerchantDeliveryMethod } from '../resolve-merchant-delivery-method';
import type { DeliveryMethod } from '../types';
import {
  calculateDeliveryCost,
  createSelectDeliveryMethod,
  getAirDeliveryQuotes,
  getDoorDeliveryQuotes,
  getStationPickupQuote,
  getStationPickupQuotes,
  isGiglGoFasterQuote,
  isMerchantQuote,
  isStationPickupQuote,
} from '../utils';
import type { CheckoutShippingQuotesOptions } from './checkout-shipping-quotes-options';
import { useAirportQuoteRecovery } from './use-airport-quote-recovery';
import type { useCheckoutAddressInference } from './use-checkout-address-inference';
import { useCheckoutDeliveryAddressHandlers } from './use-checkout-delivery-address-handlers';
import { useCheckoutDeliveryOptions } from './use-checkout-delivery-options';
import type { useCheckoutFormState } from './use-checkout-form-state';
import { useCheckoutShippingQuotes } from './use-checkout-shipping-quotes';

type CheckoutForm = ReturnType<typeof useCheckoutFormState>;
type CheckoutFields = CheckoutForm['values'];

interface UseCheckoutDeliverySessionOptions
  extends Omit<
    CheckoutShippingQuotesOptions,
    'addresses' | 'selectedAddressId' | 'isNewAddressMode' | 'setDeliveryMethod'
  > {
  airportType: CheckoutFields['airportType'];
  airportRequiresQuote: CheckoutFields['airportRequiresQuote'];
  completedSteps: CheckoutFields['completedSteps'];
  merchantSlug?: string;
  inferredLocation: ReturnType<typeof useCheckoutAddressInference>;
}

/** Own delivery address, quote selection, validation and cost projections. */
export function useCheckoutDeliverySession({
  airportRequiresQuote,
  airportType,
  completedSteps,
  inferredLocation,
  merchantSlug,
  ...shippingInput
}: UseCheckoutDeliverySessionOptions) {
  const [addresses, setAddresses] = useState<
    NonNullable<CheckoutShippingQuotesOptions['addresses']>
  >([]);
  const [selectedAddressId, setSelectedAddressId] = useState(0);
  const [isNewAddressMode, setIsNewAddressMode] = useState(true);
  const [shippingStates, setShippingStates] = useState<string[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void loadShippingStates({
      merchantCountry: shippingInput.merchantCountry,
      signal: controller.signal,
      setIsLoadingLocations,
      setShippingStates,
    });

    return () => controller.abort();
  }, [shippingInput.merchantCountry]);
  const { clearInferredLocationDebounce, scheduleInferredLocationUpdate } =
    inferredLocation;

  const setDeliveryMethod = (method: DeliveryMethod) =>
    shippingInput.setCheckoutField('deliveryMethod', method);
  const setAirportType = (type: CheckoutFields['airportType']) =>
    shippingInput.setCheckoutField('airportType', type);
  const setAirportRequiresQuote = (required: boolean) =>
    shippingInput.setCheckoutField('airportRequiresQuote', required);
  const setNewAddressCity = (city: string) =>
    shippingInput.setCheckoutField('newAddressCity', city);
  const setNewAddressState = (state: string) =>
    shippingInput.setCheckoutField('newAddressState', state);

  const quotes = useCheckoutShippingQuotes({
    ...shippingInput,
    addresses,
    isNewAddressMode,
    selectedAddressId,
    setDeliveryMethod,
  });
  const addressHandlers = useCheckoutDeliveryAddressHandlers({
    clearInferredLocationDebounce,
    merchantCountry: shippingInput.merchantCountry,
    newAddressCity: shippingInput.newAddressCity,
    newAddressState: shippingInput.newAddressState,
    resetQuotesForAddressChange: quotes.resetQuotesForAddressChange,
    scheduleInferredLocationUpdate,
    setFields: shippingInput.setCheckoutFields,
    setIsNewAddressMode,
    setNewAddressCity,
    setNewAddressState,
    setSelectedAddressId,
    shippingStates,
  });

  const stationPickupQuote = getStationPickupQuote(quotes.shippingQuotes);
  const stationPickupQuotes = getStationPickupQuotes(quotes.shippingQuotes);
  const hasMerchantPickupQuote = stationPickupQuotes.some(isMerchantQuote);
  const doorDeliveryQuotes = getDoorDeliveryQuotes(quotes.shippingQuotes);
  const airDeliveryQuotes = getAirDeliveryQuotes(quotes.shippingQuotes);
  const selectedQuote = quotes.shippingQuotes.find(
    (quote) => String(quote.id) === String(quotes.selectedQuoteId)
  );
  const selectedQuoteMatchesDeliveryMethod = Boolean(
    selectedQuote &&
      ((shippingInput.deliveryMethod === 'door' &&
        !isStationPickupQuote(selectedQuote)) ||
        (shippingInput.deliveryMethod === 'airport' &&
          isGiglGoFasterQuote(selectedQuote)) ||
        (shippingInput.deliveryMethod === 'pickup_station' &&
          isStationPickupQuote(selectedQuote)))
  );
  const selectDeliveryMethod = createSelectDeliveryMethod({
    selectedQuoteId: quotes.selectedQuoteId,
    setDeliveryMethod,
    setSelectedQuoteId: quotes.setSelectedQuoteId,
    shippingQuotes: quotes.shippingQuotes,
  });
  const hasDeliveryCoordinates = Boolean(
    Number.isFinite(shippingInput.deliveryCoordinates?.latitude) &&
      Number.isFinite(shippingInput.deliveryCoordinates?.longitude)
  );
  const deliveryOptions = useCheckoutDeliveryOptions({
    airportRequiresQuote,
    airportType,
    airDeliveryQuotes,
    city: shippingInput.newAddressCity,
    deliveryMethod: shippingInput.deliveryMethod,
    doorDeliveryQuotes,
    fetchShippingQuotes: (deliveryPreference) => {
      quotes.fetchShippingQuotes(
        shippingInput.newAddressStreet,
        shippingInput.newAddressState,
        shippingInput.newAddressCity,
        shippingInput.customerPhone,
        shippingInput.firstName,
        shippingInput.lastName,
        shippingInput.customerEmail,
        deliveryPreference
      );
    },
    hasMerchantPickupQuote,
    needsGiglLocation:
      shippingInput.merchantCountry === 'NG' && !hasDeliveryCoordinates,
    isHydrated: shippingInput.isHydrated,
    isLoadingQuotes: quotes.isLoadingQuotes,
    isNewAddressMode,
    merchantSlug,
    newAddressState: shippingInput.newAddressState,
    selectedAddressId,
    selectedQuoteId: quotes.selectedQuoteId,
    selectedQuoteMatchesDeliveryMethod,
    setAirportRequiresQuote,
    setAirportType,
    setDeliveryMethod,
    selectDeliveryMethod,
    setSelectedQuoteId: quotes.setSelectedQuoteId,
    stationPickupQuote,
    stationPickupQuotes,
  });

  const eligibleDeliveryMethod = resolveMerchantDeliveryMethod(
    shippingInput.deliveryMethod,
    shippingInput.newAddressState,
    merchantSlug
  );
  // These guarded updates correct the CheckoutPage form during its render, so
  // invalid methods cannot reach validation or submission for an extra frame.
  if (eligibleDeliveryMethod !== shippingInput.deliveryMethod) {
    setDeliveryMethod(eligibleDeliveryMethod);
  }

  // Keep the legacy pickup tab from bypassing a configured merchant pickup rate.
  const firstMerchantPickupQuoteId = hasMerchantPickupQuote
    ? (stationPickupQuotes.find(isMerchantQuote)?.id ?? '')
    : '';
  if (
    hasMerchantPickupQuote &&
    shippingInput.deliveryMethod === 'pickup' &&
    eligibleDeliveryMethod === 'pickup'
  ) {
    setDeliveryMethod('pickup_station');
    if (firstMerchantPickupQuoteId) {
      quotes.setSelectedQuoteId(firstMerchantPickupQuoteId);
    }
  }

  const rawIsDeliveryValid = (() => {
    if (!shippingInput.deliveryMethod) return false;
    if (eligibleDeliveryMethod !== shippingInput.deliveryMethod) return false;
    if (
      selectedQuote?.provider === 'GIGL' &&
      !hasDeliveryCoordinates &&
      ['door', 'pickup_station', 'airport'].includes(
        shippingInput.deliveryMethod
      )
    )
      return false;
    if (shippingInput.deliveryMethod === 'door') {
      return Boolean(
        (!isNewAddressMode || quotes.isNewDeliveryAddressReady) &&
          quotes.selectedQuoteId &&
          selectedQuoteMatchesDeliveryMethod
      );
    }
    if (shippingInput.deliveryMethod === 'pickup_station') {
      return Boolean(
        quotes.selectedQuoteId && selectedQuoteMatchesDeliveryMethod
      );
    }
    if (shippingInput.deliveryMethod === 'airport') {
      return isAirportDeliveryReady(
        airportRequiresQuote,
        selectedQuoteMatchesDeliveryMethod
      );
    }
    return true;
  })();
  const isValid = shippingInput.isHydrated ? rawIsDeliveryValid : false;
  useAirportQuoteRecovery(
    shippingInput.isHydrated &&
      shippingInput.deliveryMethod === 'airport' &&
      airportRequiresQuote &&
      !selectedQuoteMatchesDeliveryMethod,
    shippingInput.currentStep,
    () =>
      shippingInput.setCheckoutFields({
        currentStep: 'delivery',
        completedSteps: { ...completedSteps, delivery: false },
      })
  );

  const deliveryCost = calculateDeliveryCost(
    shippingInput.deliveryMethod,
    quotes.selectedQuoteId,
    quotes.shippingQuotes,
    airportType
  );

  return {
    address: {
      addresses,
      setAddresses,
      selectedId: selectedAddressId,
      setSelectedId: setSelectedAddressId,
      isNewMode: isNewAddressMode,
      setIsNewMode: setIsNewAddressMode,
      shippingStates,
      hasDeliveryCoordinates,
      isLoadingLocations,
      isNewDeliveryAddressReady: quotes.isNewDeliveryAddressReady,
      handlers: addressHandlers,
    },
    method: {
      selected: shippingInput.deliveryMethod,
      set: setDeliveryMethod,
      eligible: eligibleDeliveryMethod,
      airportType,
      setAirportType,
      airportRequiresQuote,
      setAirportRequiresQuote,
      select: selectDeliveryMethod,
    },
    quotes: {
      items: quotes.shippingQuotes,
      loading: quotes.isLoadingQuotes,
      selectedId: quotes.selectedQuoteId,
      setSelectedId: quotes.setSelectedQuoteId,
      selected: selectedQuote,
      matchesSelectedMethod: selectedQuoteMatchesDeliveryMethod,
      hasMerchantPickup: hasMerchantPickupQuote,
      stationPickup: stationPickupQuote,
      stationPickupOptions: stationPickupQuotes,
      doorOptions: doorDeliveryQuotes,
      airOptions: airDeliveryQuotes,
      resetForAddressChange: quotes.resetQuotesForAddressChange,
      fetch: quotes.fetchShippingQuotes,
    },
    options: deliveryOptions,
    validation: { isValid },
    cost: deliveryCost,
  };
}
