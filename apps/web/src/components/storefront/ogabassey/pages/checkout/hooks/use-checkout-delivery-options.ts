'use client';

import type { ComponentProps } from 'react';
import { canShowDeliveryMethods } from '../can-show-delivery-methods';
import type { AirportDeliveryOptions } from '../components/AirportDeliveryOptions';
import type { DeliveryMethodTabs } from '../components/DeliveryMethodTabs';
import type { DeliveryOptions } from '../components/DeliveryOptions';
import type { DoorDeliveryQuoteOptions } from '../components/DoorDeliveryQuoteOptions';
import type { StationPickupOptions } from '../components/StationPickupOptions';
import type { DeliveryMethod } from '../types';

type DeliveryOptionsProps = ComponentProps<typeof DeliveryOptions>;

interface UseCheckoutDeliveryOptionsInput {
  airportRequiresQuote: boolean;
  airportType: ComponentProps<typeof AirportDeliveryOptions>['airportType'];
  airDeliveryQuotes: ComponentProps<
    typeof AirportDeliveryOptions
  >['airDeliveryQuotes'];
  city: string;
  deliveryMethod: DeliveryMethod;
  doorDeliveryQuotes: ComponentProps<
    typeof DoorDeliveryQuoteOptions
  >['doorDeliveryQuotes'];
  fetchShippingQuotes: (preference: 'door' | 'pickup_station') => void;
  hasMerchantPickupQuote: boolean;
  needsGiglLocation?: boolean;
  isHydrated: boolean;
  isLoadingQuotes: boolean;
  isNewAddressMode: boolean;
  merchantSlug?: string;
  newAddressState: string;
  selectedAddressId: number;
  selectedQuoteId: string;
  selectedQuoteMatchesDeliveryMethod: boolean;
  setAirportRequiresQuote: (required: boolean) => void;
  setAirportType: (
    type: ComponentProps<typeof AirportDeliveryOptions>['airportType']
  ) => void;
  setDeliveryMethod: (method: DeliveryMethod) => void;
  selectDeliveryMethod: (method: DeliveryMethod) => void;
  setSelectedQuoteId: (id: string) => void;
  stationPickupQuote: ComponentProps<
    typeof DeliveryMethodTabs
  >['stationPickupQuote'];
  stationPickupQuotes: ComponentProps<
    typeof StationPickupOptions
  >['stationPickupQuotes'];
}

/** Keeps delivery-method visibility and option callbacks together with their UI. */
export function useCheckoutDeliveryOptions({
  airportRequiresQuote,
  airportType,
  airDeliveryQuotes,
  city,
  deliveryMethod,
  doorDeliveryQuotes,
  fetchShippingQuotes,
  hasMerchantPickupQuote,
  needsGiglLocation = false,
  isHydrated,
  isLoadingQuotes,
  isNewAddressMode,
  merchantSlug,
  newAddressState,
  selectedAddressId,
  selectedQuoteId,
  selectedQuoteMatchesDeliveryMethod,
  setAirportRequiresQuote,
  setAirportType,
  setDeliveryMethod,
  selectDeliveryMethod,
  setSelectedQuoteId,
  stationPickupQuote,
  stationPickupQuotes,
}: UseCheckoutDeliveryOptionsInput): DeliveryOptionsProps | null {
  if (
    !canShowDeliveryMethods({
      isHydrated,
      isNewAddressMode,
      selectedAddressId,
      city,
      state: newAddressState,
    })
  ) {
    return null;
  }

  const hasMixedPickupLocations =
    hasMerchantPickupQuote &&
    stationPickupQuotes.some((quote) => quote.provider === 'GIGL');
  return {
    tabs: {
      deliveryMethod,
      newAddressState,
      merchantSlug,
      stationPickupQuote,
      hasMerchantPickupQuote,
      hasMixedPickupLocations,
      onSelect: selectDeliveryMethod,
    },
    station: {
      isLoadingQuotes,
      stationPickupQuote,
      stationPickupQuotes,
      selectedQuoteId,
      setSelectedQuoteId,
      onRefreshRates: () => fetchShippingQuotes('pickup_station'),
      needsGiglLocation,
      hasMixedPickupLocations,
    },
    airport: {
      airportType,
      requiresProviderQuote: airportRequiresQuote,
      city,
      state: newAddressState,
      selectedQuoteId,
      selectedQuoteMatchesDeliveryMethod,
      airDeliveryQuotes,
      onSelectAirportType: (type) => {
        setAirportType(type);
        setAirportRequiresQuote(false);
        setSelectedQuoteId('');
      },
      onSelectQuote: (id) => {
        setAirportRequiresQuote(true);
        setSelectedQuoteId(id);
      },
    },
    door: {
      needsGiglLocation,
      isLoadingQuotes,
      doorDeliveryQuotes,
      stationPickupQuote,
      selectedQuoteId,
      onSelectQuote: setSelectedQuoteId,
      onSelectStationPickup: (quoteId) => {
        setSelectedQuoteId(quoteId);
        setDeliveryMethod('pickup_station');
      },
      onRefreshRates: () => fetchShippingQuotes('door'),
    },
  };
}
