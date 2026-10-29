import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ShippingQuote } from '../types';
import { useCheckoutDeliverySession } from './use-checkout-delivery-session';

const quote: ShippingQuote = {
  id: 'gigl-quote',
  provider: 'GIGL',
  serviceTier: 'GoStandard',
  carrierName: 'GIG Logistics',
  displayName: 'GIG Logistics - Standard',
  estimatedDays: 2,
  price: 3000,
  currency: 'NGN',
  pickupIncluded: true,
  insuranceIncluded: true,
};

afterEach(() => vi.unstubAllGlobals());

it.each([
  'door',
  'pickup_station',
] as const)('blocks a restored GIGL %s quote without its destination pin', async (deliveryMethod) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.includes('/locations')
          ? { states: ['Lagos'] }
          : {
              quotes: [
                {
                  ...quote,
                  isStationPickup: deliveryMethod === 'pickup_station',
                },
              ],
            }
      )
    )
  );
  const setCheckoutFields = vi.fn();
  const setCheckoutField = vi.fn();
  const input = {
    isHydrated: true,
    merchantId: 'merchant-fixture',
    merchantCountry: 'NG',
    merchantSlug: 'ogabassey',
    checkoutCart: [{ name: 'Phone', price: 1000, quantity: 1 }],
    checkoutCartCatalogSubtotal: 1000,
    quoteItemsFingerprint: 'phone:1:1000',
    deliveryCoordinates: null as { latitude: number; longitude: number } | null,
    persistedSelectedQuoteId: quote.id,
    persistedSelectedProviderRateId: '',
    currentStep: 'delivery' as const,
    setCurrentStep: vi.fn(),
    setCheckoutField,
    setCheckoutFields,
    deliveryMethod,
    newAddressStreet: '12 Sample Estate Ogombo',
    newAddressCity: 'Ogombo',
    newAddressState: 'Lagos',
    customerPhone: '08000000001',
    firstName: 'Test',
    lastName: 'Customer',
    customerEmail: 'checkout@example.test',
    airportType: 'delivery' as const,
    airportRequiresQuote: false,
    completedSteps: { contact: true, delivery: false },
    inferredLocation: {
      clearInferredLocationDebounce: vi.fn(),
      scheduleInferredLocationUpdate: vi.fn(),
    },
  };
  const { result, rerender } = renderHook(useCheckoutDeliverySession, {
    initialProps: input,
  });
  await waitFor(() => expect(result.current.quotes.items).toHaveLength(1));
  await waitFor(() => expect(result.current.quotes.selectedId).toBe(quote.id));
  expect(result.current.quotes.matchesSelectedMethod).toBe(true);
  expect(result.current.validation.isValid).toBe(false);

  rerender({
    ...input,
    deliveryCoordinates: { latitude: 6.4654, longitude: 3.4064 },
  });
  await waitFor(() => expect(result.current.validation.isValid).toBe(true));

  act(() => result.current.address.handlers.onCityChange('Epe'));
  expect(setCheckoutFields).toHaveBeenCalledWith({
    newAddressCity: 'Epe',
    deliveryCoordinates: null,
  });
  expect(setCheckoutField).toHaveBeenCalledWith('selectedQuoteId', '');
  expect(result.current.validation.isValid).toBe(false);
});
