import { describe, expect, it, jest } from '@jest/globals';
import type { UseFormSetValue } from 'react-hook-form';
import type { ShippingAddressInput } from '@/lib/validation';
import { createCheckoutShippingHandlers } from './checkout-shipping-handlers';

type HandlerParams = Parameters<typeof createCheckoutShippingHandlers>[0];

function createParams(overrides: Partial<HandlerParams>): HandlerParams {
  return {
    committedAddress: '',
    currentShippingQuoteContextKey: '',
    deliveryCoordinates: null,
    deliveryMethod: 'door',
    googleSuggestedCityRef: { current: null },
    quoteSelection: { selectedQuoteId: '', shippingQuotes: [] },
    requestShippingQuotes: jest.fn(),
    resolvedShippingQuoteContextKey: '',
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
    shippingStates: [],
    stationPickupQuote: undefined,
    watchedAddress: '',
    watchedCity: '',
    watchedState: '',
    ...overrides,
  };
}

describe('Google state-name city validation', () => {
  it('defers a fresh state-name city until the matching city list loads', () => {
    const googleSuggestedCityRef = { current: null as string | null };
    const setValue = jest.fn() as jest.MockedFunction<
      UseFormSetValue<ShippingAddressInput>
    >;

    createCheckoutShippingHandlers(
      createParams({
        googleSuggestedCityRef,
        setValue,
        shippingCities: [],
        shippingCitiesState: '',
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

    expect(googleSuggestedCityRef.current).toBe('Lagos');
    expect(setValue).toHaveBeenCalledWith('city', '', {
      shouldValidate: false,
    });
  });

  it('preserves a state-name suggestion when the loaded list belongs to another state', () => {
    const googleSuggestedCityRef = { current: null as string | null };
    const setValue = jest.fn() as jest.MockedFunction<
      UseFormSetValue<ShippingAddressInput>
    >;

    createCheckoutShippingHandlers(
      createParams({
        googleSuggestedCityRef,
        setValue,
        shippingCities: ['Ikeja'],
        shippingCitiesState: 'Lagos',
        shippingStates: ['Kano'],
      })
    ).handleDeliveryAddressSelect(
      {
        city: 'Kano',
        country: 'Nigeria',
        formattedAddress: 'Kano, Nigeria',
        latitude: 12,
        longitude: 8.5,
        route: 'Kano',
        state: 'Kano',
        streetNumber: '',
        zip: '',
      },
      jest.fn()
    );

    expect(setValue).toHaveBeenCalledWith('city', '', {
      shouldValidate: false,
    });
    expect(googleSuggestedCityRef.current).toBe('Kano');
  });
});
