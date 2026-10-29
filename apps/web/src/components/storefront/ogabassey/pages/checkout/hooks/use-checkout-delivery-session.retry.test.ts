import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ShippingQuote } from '../types';
import { useCheckoutDeliverySession } from './use-checkout-delivery-session';

const merchantQuote: ShippingQuote = {
  id: 'merchant-rate',
  provider: 'MERCHANT',
  serviceTier: 'Standard',
  carrierName: 'Store',
  displayName: 'Store delivery',
  estimatedDays: 2,
  price: 1000,
  currency: 'NGN',
  pickupIncluded: true,
  insuranceIncluded: false,
};

function input(): Parameters<typeof useCheckoutDeliverySession>[0] {
  return {
    isHydrated: true,
    merchantId: 'merchant-fixture',
    merchantCountry: 'NG',
    merchantSlug: 'ogabassey',
    checkoutCart: [{ name: 'Phone', price: 1000, quantity: 1 }],
    checkoutCartCatalogSubtotal: 1000,
    quoteItemsFingerprint: 'phone:1:1000',
    deliveryCoordinates: null,
    persistedSelectedQuoteId: '',
    persistedSelectedProviderRateId: '',
    currentStep: 'delivery',
    setCurrentStep: vi.fn(),
    setCheckoutField: vi.fn(),
    setCheckoutFields: vi.fn(),
    deliveryMethod: 'pickup_station',
    newAddressStreet: '',
    newAddressCity: 'Ogombo',
    newAddressState: 'Lagos',
    customerPhone: '08000000001',
    firstName: 'Test',
    lastName: 'Customer',
    customerEmail: 'checkout@example.test',
    airportType: 'delivery',
    airportRequiresQuote: false,
    completedSteps: { contact: true, delivery: false },
    inferredLocation: {
      clearInferredLocationDebounce: vi.fn(),
      scheduleInferredLocationUpdate: vi.fn(),
    },
  };
}

function mockResponses(quotes: ShippingQuote[]) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
    Response.json(
      String(url).includes('/locations') ? { states: ['Lagos'] } : { quotes }
    )
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

it.each([
  '',
  '12 Sample Estate Ogombo',
])('retries pickup with the pickup preference when street is %j', async (street) => {
  const fetch = mockResponses([]);
  const { result } = renderHook(useCheckoutDeliverySession, {
    initialProps: { ...input(), newAddressStreet: street },
  });
  await waitFor(() => expect(result.current.quotes.loading).toBe(false));
  fetch.mockClear();
  await act(async () => result.current.options?.station.onRefreshRates());
  const requests = fetch.mock.calls.filter(([url]) =>
    String(url).includes('/shipping/quotes')
  );
  expect(requests).toHaveLength(1);
  expect(JSON.parse(String(requests[0]?.[1]?.body))).toMatchObject({
    deliveryPreference: 'pickup_station',
  });
});

it('keeps home delivery at the address step until its street is present', async () => {
  mockResponses([merchantQuote]);
  const initialProps = {
    ...input(),
    deliveryMethod: 'door' as const,
    persistedSelectedQuoteId: merchantQuote.id,
  };
  const { result, rerender } = renderHook(useCheckoutDeliverySession, {
    initialProps,
  });
  await waitFor(() => expect(result.current.quotes.items).toHaveLength(1));
  expect(result.current.quotes.matchesSelectedMethod).toBe(true);
  expect(result.current.validation.isValid).toBe(false);
  rerender({ ...initialProps, newAddressStreet: '12 Sample Estate Ogombo' });
  await waitFor(() => expect(result.current.validation.isValid).toBe(true));
});
