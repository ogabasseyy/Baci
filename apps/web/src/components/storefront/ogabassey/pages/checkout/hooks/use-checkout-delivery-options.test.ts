import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
});
