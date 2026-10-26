import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { buildOrderPayload } from '@/services/orders.payload';
import { CreateOrderRequestSchema } from '@/services/orders.schemas';
import {
  buildCheckoutOrderRequest,
  createCheckoutSnapshot,
} from './checkout-order-builders';
import { fetchShippingQuotes } from './checkout-shipping.helpers';
import type { ShippingQuote } from './types';

const items = [
  {
    id: 'line-1',
    product_id: 'product-1',
    name: 'Phone',
    slug: 'phone',
    quantity: 1,
    price: 1000,
  },
];
const address = {
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: '08012345678',
  address: '',
  city: 'Port Harcourt',
  state: 'Rivers',
};

// These are client-only tests: the server still validates the quoted receiver.
jest.mock('./checkout-screen.constants', () => ({
  CHECKOUT_MERCHANT_ID: 'merchant-1',
}));
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: 'merchant-1' } }));

describe('GIG station quote destination through order serialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    '',
    '12 Customer Street',
  ])('preserves the quoted receiver street %j through Credit Direct checkout', async (street) => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        quotes: {
          all: [
            {
              id: '5ec1bd0e-7838-4379-a9e6-d47167f1d0c9',
              displayName: 'GIGL Port Harcourt',
              provider: 'GIGL',
              price: 2500,
              isStationPickup: true,
              stationName: 'PORT HARCOURT',
              stationAddress: '99 Station Road, Port Harcourt',
            },
          ],
        },
      }),
    } as Response);
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    let quotes: ShippingQuote[] = [];
    try {
      await fetchShippingQuotes({
        apiUrl: 'https://example.com',
        state: address.state,
        city: address.city,
        items,
        customer: null,
        watchedFirstName: address.firstName,
        watchedLastName: address.lastName,
        watchedPhone: address.phone,
        watchedEmail: address.email,
        watchedAddress: street,
        deliveryPreference: 'pickup_station',
        quoteContextKey: 'context',
        shouldResetSelection: true,
        setIsLoadingQuotes: jest.fn(),
        setSelectedQuoteId: jest.fn(),
        setResolvedShippingQuoteContextKey: jest.fn(),
        setShippingQuotes: (value) => {
          quotes = value;
        },
      });
      expect(quotes).toHaveLength(1);
      const quotedDestination = JSON.parse(
        String(fetchMock.mock.calls[0]?.[1]?.body)
      ).receiver;
      const request = buildCheckoutOrderRequest({
        address: { ...address, address: street },
        customerEmail: address.email,
        customerName: 'Ada Lovelace',
        customerPhone: address.phone,
        deliveryMethod: 'pickup_station',
        itemsSnapshot: items,
        paymentMethodForOrder: 'credit_direct',
        selectedQuote: quotes[0],
        shippingProvider: 'GIGL',
        snapshot: createCheckoutSnapshot(items, 2500, 0),
      });
      const payload = buildOrderPayload({
        merchantId: 'merchant-1',
        request: CreateOrderRequestSchema.parse(request),
      });
      expect(payload.shipping_address).toEqual(
        expect.objectContaining({
          address: quotedDestination.address,
          city: quotedDestination.city,
          state: quotedDestination.state,
        })
      );
      expect(payload.selected_quote_id).toBe(quotes[0].id);
      expect(payload.shipping_provider).toBe('GIGL');
      expect(quotes[0].stationAddress).toBe('99 Station Road, Port Harcourt');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
