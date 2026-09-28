import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutShippingQuotesOptions } from './checkout-shipping-quotes-options';
import { useCheckoutDeliverySession } from './use-checkout-delivery-session';
import type { ShippingQuote } from '../types';

const merchantPickupQuote: ShippingQuote = {
  id: 'merchant-pickup',
  provider: 'MERCHANT',
  serviceTier: 'pickup',
  carrierName: 'Store Pickup',
  displayName: 'Store Pickup',
  estimatedDays: 0,
  price: 1500,
  currency: 'NGN',
  pickupIncluded: false,
  insuranceIncluded: false,
  isStationPickup: true,
};

type DeliveryOverrides = Partial<CheckoutShippingQuotesOptions> &
  Partial<{
    airportType: 'delivery' | 'pickup';
    airportRequiresQuote: boolean;
    completedSteps: { contact: boolean; delivery: boolean };
    merchantSlug: string;
  }>;

function options(overrides: DeliveryOverrides = {}) {
  const setCheckoutFields = vi.fn();
  const base: CheckoutShippingQuotesOptions = {
    isHydrated: true,
    merchantId: 'merchant-1',
    merchantCountry: 'NG',
    checkoutCart: [{ name: 'Phone', price: 1000, quantity: 1 }],
    checkoutCartCatalogSubtotal: 1000,
    quoteItemsFingerprint: 'phone:1:1000',
    deliveryCoordinates: null,
    persistedSelectedQuoteId: '',
    persistedSelectedProviderRateId: '',
    currentStep: 'delivery',
    setCurrentStep: vi.fn(),
    setCheckoutField: vi.fn(),
    setCheckoutFields,
    setDeliveryMethod: vi.fn(),
    deliveryMethod: 'door',
    newAddressStreet: '1 Airport Road, Ikeja, Lagos',
    newAddressState: 'Lagos',
    newAddressCity: 'Ikeja',
    customerPhone: '08012345678',
    firstName: 'Ada',
    lastName: 'Eze',
    customerEmail: 'ada@example.com',
    isNewAddressMode: true,
    addresses: [],
    selectedAddressId: 0,
    ...overrides,
  };
  return {
    ...base,
    airportType: overrides.airportType ?? 'delivery',
    airportRequiresQuote: overrides.airportRequiresQuote ?? false,
    completedSteps: overrides.completedSteps ?? {
      contact: true,
      delivery: false,
    },
    merchantSlug: overrides.merchantSlug ?? 'ogabassey',
    inferredLocation: {
      clearInferredLocationDebounce: vi.fn(),
      scheduleInferredLocationUpdate: vi.fn(),
    },
    setCheckoutFields,
  };
}

function quoteResponse(quotes: ShippingQuote[]) {
  return Response.json({ quotes: { featured: quotes, all: quotes } });
}

const mockFetch = vi.fn<typeof fetch>();

describe('useCheckoutDeliverySession', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('invalidates an in-flight quote when the address changes', async () => {
    mockFetch.mockImplementation((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })
    );
    const input = options();
    const { result } = renderHook(() =>
      useCheckoutDeliverySession(input)
    );
    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());
    const quoteRequestSignal = mockFetch.mock.calls[0]?.[1]?.signal;

    act(() => result.current.address.handlers.onStreetChange('2 Allen Avenue'));

    expect(quoteRequestSignal?.aborted).toBe(true);
    expect(input.setCheckoutField).toHaveBeenCalledWith('selectedQuoteId', '');
    expect(input.setCheckoutFields).toHaveBeenCalledWith({
      deliveryCoordinates: null,
    });
  });

  it('uses the selected merchant station rate for validation and delivery cost', async () => {
    mockFetch.mockResolvedValue(quoteResponse([merchantPickupQuote]));
    const input = options({
      deliveryMethod: 'pickup_station',
      persistedSelectedQuoteId: merchantPickupQuote.id,
    });
    const { result } = renderHook(() =>
      useCheckoutDeliverySession(input)
    );

    await waitFor(() => expect(result.current.quotes.items).toHaveLength(1));

    expect(result.current.quotes.hasMerchantPickup).toBe(true);
    expect(result.current.quotes.matchesSelectedMethod).toBe(true);
    expect(result.current.validation.isValid).toBe(true);
    expect(result.current.cost).toBe(1500);
  });

  it('moves legacy pickup onto the configured merchant station rate', async () => {
    mockFetch.mockResolvedValue(quoteResponse([merchantPickupQuote]));
    const input = options();
    const { rerender } = renderHook(
      (props) => useCheckoutDeliverySession(props),
      { initialProps: input }
    );
    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());

    rerender({ ...input, deliveryMethod: 'pickup' });

    await waitFor(() =>
      expect(input.setCheckoutField).toHaveBeenCalledWith(
        'deliveryMethod',
        'pickup_station'
      )
    );
    expect(input.setCheckoutField).toHaveBeenCalledWith(
      'selectedQuoteId',
      merchantPickupQuote.id
    );
  });

  it('reopens delivery when the restored airport quote is not a GoFaster quote', async () => {
    mockFetch.mockResolvedValue(
      quoteResponse([
        {
          ...merchantPickupQuote,
          id: 'door-rate',
          provider: 'GIGL',
          serviceTier: 'standard',
          isStationPickup: false,
        },
      ])
    );
    const input = options({
      currentStep: 'payment',
      deliveryMethod: 'airport',
      persistedSelectedQuoteId: 'restored-airport-quote',
      airportRequiresQuote: true,
    });
    const { result } = renderHook(() =>
      useCheckoutDeliverySession(input)
    );

    await waitFor(() =>
      expect(input.setCheckoutFields).toHaveBeenCalledWith({
        currentStep: 'delivery',
        completedSteps: { contact: true, delivery: false },
      })
    );
    expect(result.current.quotes.matchesSelectedMethod).toBe(false);
    expect(result.current.validation.isValid).toBe(false);
  });
});
