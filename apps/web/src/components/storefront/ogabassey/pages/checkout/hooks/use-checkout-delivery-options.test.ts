import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createSelectDeliveryMethod } from '../create-select-delivery-method';
import {
  doorQuote,
  secondStationQuote,
  stationQuote,
} from '../delivery-quote-test-fixtures.test-support';
import { useCheckoutDeliveryOptions } from './use-checkout-delivery-options';

function renderDeliveryOptions() {
  const callbacks = {
    fetchShippingQuotes: vi.fn(),
    setAirportRequiresQuote: vi.fn(),
    setAirportType: vi.fn(),
    setDeliveryMethod: vi.fn(),
    setSelectedQuoteId: vi.fn(),
  };
  const { result } = renderHook(() =>
    useCheckoutDeliveryOptions({
      airportRequiresQuote: false,
      airportType: 'delivery',
      airDeliveryQuotes: [],
      city: 'Ikeja',
      deliveryMethod: 'airport',
      doorDeliveryQuotes: [],
      fetchShippingQuotes: callbacks.fetchShippingQuotes,
      hasMerchantPickupQuote: false,
      isHydrated: true,
      isLoadingQuotes: false,
      isNewAddressMode: true,
      merchantSlug: 'ogabassey',
      newAddressState: 'Lagos',
      selectedAddressId: 0,
      selectedQuoteId: 'previous-quote',
      selectedQuoteMatchesDeliveryMethod: false,
      setAirportRequiresQuote: callbacks.setAirportRequiresQuote,
      setAirportType: callbacks.setAirportType,
      setDeliveryMethod: callbacks.setDeliveryMethod,
      selectDeliveryMethod: callbacks.setDeliveryMethod,
      setSelectedQuoteId: callbacks.setSelectedQuoteId,
      stationPickupQuote: undefined,
      stationPickupQuotes: [],
    })
  );

  return { callbacks, result };
}

describe('useCheckoutDeliveryOptions', () => {
  it('invalidates a selected quote when changing airport type', () => {
    const { callbacks, result } = renderDeliveryOptions();

    act(() => result.current?.airport.onSelectAirportType('pickup'));

    expect(callbacks.setAirportType).toHaveBeenCalledWith('pickup');
    expect(callbacks.setAirportRequiresQuote).toHaveBeenCalledWith(false);
    expect(callbacks.setSelectedQuoteId).toHaveBeenCalledWith('');
  });

  it('requires a provider quote after selecting an airport quote', () => {
    const { callbacks, result } = renderDeliveryOptions();

    act(() => result.current?.airport.onSelectQuote('airport-quote-1'));

    expect(callbacks.setAirportRequiresQuote).toHaveBeenCalledWith(true);
    expect(callbacks.setSelectedQuoteId).toHaveBeenCalledWith(
      'airport-quote-1'
    );
  });

  it('keeps the chosen pickup quote instead of applying the tab default', () => {
    let selectedQuoteId = 'door-1';
    const setSelectedQuoteId = (quoteId: string) => {
      selectedQuoteId = quoteId;
    };
    const setDeliveryMethod = vi.fn();
    const selectDeliveryMethod = createSelectDeliveryMethod({
      selectedQuoteId,
      setDeliveryMethod,
      setSelectedQuoteId,
      shippingQuotes: [doorQuote, stationQuote, secondStationQuote],
    });
    const { result } = renderHook(() =>
      useCheckoutDeliveryOptions({
        airportRequiresQuote: false,
        airportType: 'delivery',
        airDeliveryQuotes: [],
        city: 'Ikeja',
        deliveryMethod: 'door',
        doorDeliveryQuotes: [doorQuote],
        fetchShippingQuotes: vi.fn(),
        hasMerchantPickupQuote: false,
        isHydrated: true,
        isLoadingQuotes: false,
        isNewAddressMode: true,
        merchantSlug: 'ogabassey',
        newAddressState: 'Lagos',
        selectedAddressId: 0,
        selectedQuoteId,
        selectedQuoteMatchesDeliveryMethod: true,
        setAirportRequiresQuote: vi.fn(),
        setAirportType: vi.fn(),
        setDeliveryMethod,
        selectDeliveryMethod,
        setSelectedQuoteId,
        stationPickupQuote: stationQuote,
        stationPickupQuotes: [stationQuote, secondStationQuote],
      })
    );

    act(() => result.current?.door.onSelectStationPickup('station-2'));

    expect(selectedQuoteId).toBe('station-2');
    expect(setDeliveryMethod).toHaveBeenCalledWith('pickup_station');
  });
});
