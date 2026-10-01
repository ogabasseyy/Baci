import { describe, expect, it, jest } from '@jest/globals';
import type { MutableRefObject } from 'react';
import type { UseFormSetValue } from 'react-hook-form';
import type { ShippingAddressInput } from '@/lib/validation';
import { createCheckoutShippingHandlers } from './checkout-shipping-handlers';
import { AIRPORT_QUOTE_ID } from './checkout-step-helpers';

type HandlerParams = Parameters<typeof createCheckoutShippingHandlers>[0];
type SavedDoorAddress = NonNullable<
  HandlerParams['savedDoorAddressRef']['current']
>;

function createParams(overrides: Partial<HandlerParams> = {}): HandlerParams {
  return {
    committedAddress: '1 Airport Road, Port Harcourt',
    currentShippingQuoteContextKey: 'quote-context',
    deliveryCoordinates: { latitude: 4.8156, longitude: 7.0498 },
    deliveryMethod: 'door',
    googleSuggestedCityRef: { current: null },
    quoteSelection: { selectedQuoteId: '', shippingQuotes: [] },
    requestShippingQuotes: jest.fn(),
    resolvedShippingQuoteContextKey: 'quote-context',
    savedDoorAddressRef: { current: null },
    setCitySearch: jest.fn(),
    setCommittedAddress: jest.fn(),
    setDeliveryCoordinates: jest.fn(),
    setDeliveryMethod: jest.fn(),
    setResolvedShippingQuoteContextKey: jest.fn(),
    setSelectedQuoteId: jest.fn(),
    setShowCityPicker: jest.fn(),
    setShowStatePicker: jest.fn(),
    setValue: jest.fn() as jest.MockedFunction<
      UseFormSetValue<ShippingAddressInput>
    >,
    shippingQuoteAbortRef: { current: null },
    shippingStates: ['Rivers'],
    stationPickupQuote: undefined,
    watchedAddress: '1 Airport Road, Port Harcourt',
    watchedCity: 'Port Harcourt',
    watchedState: 'Rivers',
    ...overrides,
  };
}

describe('createCheckoutShippingHandlers', () => {
  it('trusts a complete Google location without routing its city through the fallback list', () => {
    const googleSuggestedCityRef = { current: null as string | null };
    const setValue = jest.fn() as jest.MockedFunction<
      UseFormSetValue<ShippingAddressInput>
    >;
    const setDeliveryCoordinates = jest.fn();

    createCheckoutShippingHandlers(
      createParams({
        googleSuggestedCityRef,
        setDeliveryCoordinates,
        setValue,
        shippingCities: ['Ikeja'],
        shippingCitiesState: 'Lagos',
        shippingStates: ['Katsina'],
      })
    ).handleDeliveryAddressSelect(
      {
        city: 'Ikeja',
        country: 'Nigeria',
        formattedAddress: '2 Olaide Tomori St, Ikeja, Lagos 101233, Nigeria',
        latitude: 6.6018,
        longitude: 3.3515,
        route: 'Olaide Tomori St',
        state: 'Lagos',
        streetNumber: '',
        zip: '101233',
      },
      jest.fn()
    );

    expect(setValue).toHaveBeenCalledWith('city', 'Ikeja', {
      shouldValidate: true,
    });
    expect(setValue).toHaveBeenCalledWith('state', 'Lagos', {
      shouldValidate: true,
    });
    expect(setDeliveryCoordinates).toHaveBeenCalledWith({
      latitude: 6.6018,
      longitude: 3.3515,
    });
    expect(googleSuggestedCityRef.current).toBeNull();
  });

  it('replaces a stale Google city with the picker sentinel when state is known', () => {
    const googleSuggestedCityRef = { current: 'Katsina' as string | null };

    createCheckoutShippingHandlers(
      createParams({ googleSuggestedCityRef })
    ).handleDeliveryAddressSelect(
      {
        city: '',
        country: 'Nigeria',
        formattedAddress: 'Unnamed Road, Katsina, Nigeria',
        latitude: 12.9908,
        longitude: 7.6018,
        route: 'Unnamed Road',
        state: 'Katsina',
        streetNumber: '',
        zip: '',
      },
      jest.fn()
    );

    expect(googleSuggestedCityRef.current).toBe('');
  });

  it('opens the city picker when Google collapses a Lagos locality into Lagos', () => {
    const googleSuggestedCityRef = { current: null as string | null };
    const setCitySearch = jest.fn();
    const setShowCityPicker = jest.fn();
    const setValue = jest.fn() as jest.MockedFunction<
      UseFormSetValue<ShippingAddressInput>
    >;

    createCheckoutShippingHandlers(
      createParams({
        googleSuggestedCityRef,
        setCitySearch,
        setShowCityPicker,
        setValue,
        shippingCities: ['Ikeja'],
        shippingCitiesState: 'Lagos',
        shippingStates: ['Lagos'],
      })
    ).handleDeliveryAddressSelect(
      {
        city: 'Lagos',
        country: 'Nigeria',
        formattedAddress: '2 Olaide Tomori St, Ikeja, Lagos, Nigeria',
        latitude: 6.6018,
        longitude: 3.3515,
        route: 'Olaide Tomori St',
        state: 'Lagos',
        streetNumber: '2',
        zip: '101233',
      },
      jest.fn()
    );

    expect(googleSuggestedCityRef.current).toBe('');
    expect(setCitySearch).toHaveBeenCalledWith('');
    expect(setShowCityPicker).toHaveBeenCalledWith(true);
    expect(setValue).toHaveBeenCalledWith('city', '', {
      shouldValidate: false,
    });
  });

  it('clears a stale Google city when the selected place has no state or city', () => {
    const googleSuggestedCityRef = { current: 'Katsina' as string | null };

    createCheckoutShippingHandlers(
      createParams({ googleSuggestedCityRef })
    ).handleDeliveryAddressSelect(
      {
        city: '',
        country: 'Nigeria',
        formattedAddress: 'Unnamed Road, Nigeria',
        route: 'Unnamed Road',
        state: '',
        streetNumber: '',
        zip: '',
      },
      jest.fn()
    );

    expect(googleSuggestedCityRef.current).toBeNull();
  });

  it('restores Google coordinates when returning from pickup to road', () => {
    const coordinates = { latitude: 4.8156, longitude: 7.0498 };
    const savedDoorAddressRef = {
      current: null,
    } as MutableRefObject<SavedDoorAddress | null>;
    createCheckoutShippingHandlers(
      createParams({ deliveryCoordinates: coordinates, savedDoorAddressRef })
    ).handleSelectDeliveryMethod('pickup_station');
    expect(savedDoorAddressRef.current?.coordinates).toEqual(coordinates);

    const setDeliveryCoordinates = jest.fn();
    createCheckoutShippingHandlers(
      createParams({
        deliveryCoordinates: null,
        deliveryMethod: 'pickup_station',
        savedDoorAddressRef,
        setDeliveryCoordinates,
      })
    ).handleSelectDeliveryMethod('door');

    expect(setDeliveryCoordinates).toHaveBeenCalledWith(coordinates);
  });

  it('restores a saved road address without inventing missing coordinates', () => {
    const setDeliveryCoordinates = jest.fn();
    const requestShippingQuotes = jest.fn();
    const savedDoorAddressRef = {
      current: {
        address: '1 Airport Road, Port Harcourt',
        city: 'Port Harcourt',
        coordinates: null,
        state: 'Rivers',
      },
    } as MutableRefObject<SavedDoorAddress | null>;

    createCheckoutShippingHandlers(
      createParams({
        deliveryMethod: 'pickup_station',
        requestShippingQuotes,
        savedDoorAddressRef,
        setDeliveryCoordinates,
      })
    ).handleSelectDeliveryMethod('door');

    expect(setDeliveryCoordinates).toHaveBeenCalledWith(null);
    expect(requestShippingQuotes).not.toHaveBeenCalled();
  });

  it('does not preserve a station GoFaster quote when switching to airport', () => {
    const setSelectedQuoteId = jest.fn();
    createCheckoutShippingHandlers(
      createParams({
        deliveryMethod: 'pickup_station',
        quoteSelection: {
          selectedQuoteId: 'station-gofaster',
          shippingQuotes: [
            {
              id: 'station-gofaster',
              displayName: 'Pickup at PHC - GoFaster',
              isStationPickup: true,
              price: 10000,
              provider: 'GIGL',
              serviceTier: 'Station Pickup - GoFaster',
            },
          ],
        },
        setSelectedQuoteId,
      })
    ).handleSelectDeliveryMethod('airport');

    expect(setSelectedQuoteId).toHaveBeenLastCalledWith(AIRPORT_QUOTE_ID);
  });
});
