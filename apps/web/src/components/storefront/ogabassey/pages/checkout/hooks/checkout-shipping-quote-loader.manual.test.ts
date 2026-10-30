import { afterEach, expect, it, vi } from 'vitest';
import { loadCheckoutShippingQuotes } from './checkout-shipping-quote-loader';

afterEach(() => vi.unstubAllGlobals());

it.each([
  { latitude: undefined, longitude: undefined, merchantOnly: true },
  { latitude: 0, longitude: 0, merchantOnly: true },
  { latitude: 6.6, longitude: 3.3, merchantOnly: false },
])('restricts pinless Nigerian requests to store rates: $merchantOnly', async ({ latitude, longitude, merchantOnly }) => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ quotes: { all: [] } }));
  vi.stubGlobal('fetch', fetchMock);
  await loadCheckoutShippingQuotes({
    address: '12 Sample Estate Ogombo', city: 'Ogombo', state: 'Lagos',
    country: 'Nigeria', countryCode: 'NG', phone: '+2348031234567',
    email: 'fixture@example.test', fName: 'Test', lName: 'Buyer',
    deliveryPreference: 'door', latitude, longitude, cartSubtotal: 1000,
  }, [{ name: 'Phone', quantity: 1, price: 1000 }], {
    activeAbortController: { current: null },
    requestSequence: { current: 0 }, currentRequestKey: '', force: true,
    setIsLoadingQuotes: vi.fn(), setResolvedQuoteRequestKey: vi.fn(),
    setSelectedQuoteId: vi.fn(), setShippingQuotes: vi.fn(),
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
    merchant_rates_only: merchantOnly,
    supports_merchant_rates: true,
  });
});
