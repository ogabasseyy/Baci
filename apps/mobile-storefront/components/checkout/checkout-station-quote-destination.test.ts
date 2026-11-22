import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { createOrder } from '@/services/orders';
import { buildOrderPayload } from '@/services/orders.payload';
import { CreateOrderRequestSchema } from '@/services/orders.schemas';
import { submitBnplCheckout } from './checkout-bnpl-submit';
import { createCheckoutSnapshot } from './checkout-order-builders';
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

// Provider/HTTP boundaries are stubbed. Quote parsing, checkout and payload
// serialization run through the same code as Place Order.
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/services/orders', () => ({ createOrder: jest.fn() }));
jest.mock('./checkout-screen.constants', () => ({
  CHECKOUT_MERCHANT_ID: 'merchant-1',
  CHECKOUT_MERCHANT_SLUG: 'ogabassey',
}));
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_ID: 'merchant-1' } }));

describe('GIG quote destination through order serialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    {
      street: '',
      city: 'Port Harcourt',
      state: 'Rivers',
      method: 'pickup_station',
    },
    {
      street: '12 Customer Street',
      city: 'Port Harcourt',
      state: 'Rivers',
      method: 'pickup_station',
    },
    {
      street: '3 Example Street',
      city: 'Abuja',
      state: 'Abuja',
      quotedState: 'FCT - Abuja',
      method: 'door',
    },
    {
      street: '3 Example Street',
      city: 'Abuja',
      state: 'Abuja',
      quotedState: 'FCT - Abuja',
      method: 'pickup_station',
    },
  ] as const)('preserves the GIG destination through Credit Direct checkout ($method, $state)', async ({
    street,
    city,
    state,
    method,
    quotedState,
  }: {
    street: string;
    city: string;
    state: string;
    method: 'door' | 'pickup_station';
    quotedState?: string;
  }) => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        receiverState: quotedState,
        quotes: {
          all: [
            {
              id: '5ec1bd0e-7838-4379-a9e6-d47167f1d0c9',
              displayName: `GIGL ${city}`,
              provider: 'GIGL',
              price: 2500,
              isStationPickup: method === 'pickup_station',
              stationName: city,
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
        state,
        city,
        items,
        customer: null,
        watchedFirstName: address.firstName,
        watchedLastName: address.lastName,
        watchedPhone: address.phone,
        watchedEmail: address.email,
        watchedAddress: street,
        deliveryPreference: method,
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
      jest.mocked(createOrder).mockImplementationOnce(async (request) => {
        const payload = buildOrderPayload({
          merchantId: 'merchant-1',
          request: CreateOrderRequestSchema.parse(request),
        });
        expect(payload.shipping_address).toEqual(
          expect.objectContaining({
            address: quotedDestination.address,
            city: quotedDestination.city,
            state: quotedState ?? quotedDestination.state,
          })
        );
        expect(payload.selected_quote_id).toBe(quotes[0].id);
        expect(payload.shipping_provider).toBe('GIGL');
        expect(payload.payment_method).toBe('credit_direct');
        expect(payload.shipping_fee).toBe(2500);
        return {
          order: {
            id: 'mock-credit-direct-order',
            order_number: 'BAC-MOCK',
            created_at: '2026-11-21T12:00:00.000Z',
            payment_status: 'pending',
            shipping_status: 'pending',
            total: 3500,
            tracking_token: null,
          },
          amountDueToGateway: 3500,
          effectiveCheckoutGeneration: 'mock-cart',
          savings: null,
          wallet: null,
        };
      });
      await submitBnplCheckout({
        address: { ...address, address: street, city, state },
        customerEmail: address.email,
        customerName: 'Ada Lovelace',
        customerPhone: address.phone,
        deliveryMethod: method,
        getShippingProvider: () => 'GIGL',
        isOrderInFlight: { current: true },
        itemsSnapshot: items,
        checkoutGeneration: 'mock-cart',
        liveSavingsSelection: undefined,
        liveWalletSelection: undefined,
        mobileCheckoutIdempotencyRef: { current: null },
        paymentMethodForOrder: 'credit_direct',
        paymentSettings: {},
        selectedPayment: 'credit_direct',
        selectedQuote: quotes[0],
        setIsProcessing: jest.fn(),
        snapshot: createCheckoutSnapshot(items, 2500, 0),
      });
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/bnpl-checkout',
        params: expect.objectContaining({
          gateway: 'credit_direct',
          orderId: 'mock-credit-direct-order',
          shipping: '2500.00',
          amount: '3500.00',
        }),
      });
      expect(quotes[0].stationAddress).toBe('99 Station Road, Port Harcourt');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
