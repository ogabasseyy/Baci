import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentItem } from './types';

const mocks = vi.hoisted(() => ({ book: vi.fn(), persist: vi.fn() }));
vi.mock('@/lib/shipping', () => ({
  shippingService: { bookShipment: mocks.book },
}));
vi.mock('./find-reusable-order-shipment', () => ({
  findReusableOrderShipment: async () => null,
}));
vi.mock('./refresh-order-shipment-quote', () => ({
  refreshOrderShipmentQuote: async (_client: unknown, quote: unknown) => quote,
}));
vi.mock('./attach-booking-quote-metadata', () => ({
  attachBookingQuoteMetadata: async (
    _client: unknown,
    _merchant: unknown,
    _order: unknown,
    quote: unknown
  ) => quote,
}));
vi.mock('./shipping-quote-booking-economics', () => ({
  getShippingQuoteBookingEconomics: async () => ({}),
  applyShippingQuoteBookingEconomicsToOrder: (order: unknown) => order,
  applyShippingQuoteBookingEconomicsToQuote: (quote: unknown) => quote,
}));
vi.mock('./assert-gigl-customer-checkout-prepaid', async (original) => ({
  ...(await original<AssertGiglCustomerCheckoutPrepaidModule>()),
  assertGiglCustomerCheckoutPrepaid: async () => undefined,
}));
vi.mock('./assert-current-shippable-order-payment', () => ({
  assertCurrentOrderPaymentShippable: async () => undefined,
}));
vi.mock('./persist-booked-order-shipment', () => ({
  persistBookedOrderShipment: mocks.persist,
}));
vi.mock('./resolve-booking-merchant-sender', () => ({
  resolveBookingMerchantSender: async () => ({
    ok: true,
    sender: {
      name: 'Store',
      phone: '08012345678',
      address: '1 Store Road',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
      countryCode: 'NG',
    },
  }),
}));

import { bookOrderShipment } from './book-order-shipment';

type AssertGiglCustomerCheckoutPrepaidModule =
  typeof import('./assert-gigl-customer-checkout-prepaid');

const receiver = {
  name: 'Customer',
  phone: '08012345678',
  address: '2 Buyer Road',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};
const originalItems = [
  {
    name: 'Phone',
    quantity: 2,
    price: 1000,
    fulfillment_data: { fulfillmentQuantity: 1 },
    product: { weight_value: 1, weight_unit: 'kg' },
  },
  {
    name: 'Case',
    quantity: 1,
    price: 100,
    fulfillment_data: { fulfillmentQuantity: 0 },
    product: { weight_value: 1, weight_unit: 'kg' },
  },
];
const legacyQuoteItems: ShipmentItem[] = [
  { name: 'Phone', quantity: 2, value: 1000, weight: 1 },
  { name: 'Case', quantity: 1, value: 100, weight: 1 },
];
function client(
  quoteItems = legacyQuoteItems,
  orderItems: unknown = originalItems
) {
  const order = {
    id: 'order',
    customer_name: 'Customer',
    customer_phone: receiver.phone,
    shipping_fee: 110,
    selected_quote_id: 'quote',
    shipping_provider: 'GIGL',
    shipping_funding_source: 'customer_checkout',
    payment_status: 'paid',
    payment_method: 'card',
    shipping_address: receiver,
    order_items: orderItems,
  };
  const quote = {
    id: 'quote',
    merchant_id: 'merchant',
    provider: 'GIGL',
    price: 110,
    currency: 'NGN',
    service_tier: 'GoStandard',
    carrier_name: 'GIG Logistics',
    provider_rate_id: 'GIGL_30_0_1_0_0_4',
    quote_request: {
      sessionId: 'order',
      shipmentType: 'domestic',
      receiver,
      items: quoteItems,
    },
  };
  return {
    from: (table: string) => ({
      select: () => ({
        eq() {
          return this;
        },
        single: async () => ({
          data: table === 'orders' ? order : quote,
          error: null,
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe('domestic booking accepts complete pre-refund or surviving quote snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.book.mockResolvedValue({
      provider: 'GIGL',
      providerShipmentId: 'provider-shipment',
      trackingNumber: 'tracking',
      carrierName: 'GIG Logistics',
      status: 'booked',
    });
    mocks.persist.mockResolvedValue({ shipmentId: 'shipment' });
  });
  it.each([
    ['original', legacyQuoteItems],
    ['surviving', [{ ...legacyQuoteItems[0], quantity: 1 }]],
  ])('books only surviving units from a complete %s quote snapshot', async (_label, quoteItems) => {
    await expect(
      bookOrderShipment(client(quoteItems), 'merchant', 'order')
    ).resolves.toMatchObject({ shipmentId: 'shipment' });
    expect(mocks.book).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        items: [
          expect.objectContaining({
            name: 'Phone',
            quantity: 1,
            weight: 1,
            value: 1000,
          }),
        ],
      })
    );
    expect(mocks.persist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        items: [expect.objectContaining({ name: 'Phone', quantity: 1 })],
      })
    );
  });
  it.each([
    [{ ...legacyQuoteItems[0], quantity: 1 }, legacyQuoteItems[1]],
    [{ ...legacyQuoteItems[0], weight: 2 }, legacyQuoteItems[1]],
    [{ ...legacyQuoteItems[0], value: 999 }, legacyQuoteItems[1]],
    [
      { ...legacyQuoteItems[0], length: 10, width: 5, height: 3 },
      legacyQuoteItems[1],
    ],
  ])('rejects mixed or changed quote contents before provider booking: %j', async (...items) => {
    await expect(
      bookOrderShipment(client(items), 'merchant', 'order')
    ).rejects.toMatchObject({ code: 'SHIPPING_QUOTE_ITEMS_MISMATCH' });
    expect(mocks.book).not.toHaveBeenCalled();
  });
  it.each([
    'weight',
    'dimensions',
    'fallback weight',
  ])('retains the surviving package when reversed duplicate rows differ by %s', async (identity) => {
    const small = { length: 10, width: 5, height: 3 };
    const large =
      identity === 'dimensions' ? { length: 20, width: 10, height: 6 } : small;
    const duplicate = { ...originalItems[0], quantity: 1 };
    const orders = [
      {
        ...duplicate,
        fulfillment_data: { fulfillmentQuantity: 0 },
        product: {
          weight_value: identity === 'fallback weight' ? undefined : 1,
          weight_unit: 'kg',
          dimensions: small,
        },
      },
      {
        ...duplicate,
        product: {
          weight_value: identity !== 'dimensions' ? 10 : 1,
          weight_unit: 'kg',
          dimensions: large,
        },
      },
    ];
    const quotes = [
      {
        ...legacyQuoteItems[0],
        quantity: 1,
        weight: identity !== 'dimensions' ? 10 : 1,
        ...large,
      },
      { ...legacyQuoteItems[0], quantity: 1, weight: 1, ...small },
    ];
    await expect(
      bookOrderShipment(client(quotes, orders), 'merchant', 'order')
    ).resolves.toMatchObject({ shipmentId: 'shipment' });
    expect(mocks.book).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({ items: [expect.objectContaining(quotes[0])] })
    );
  });

  it('rejects zero survivors even if the whole original quote still matches', async () => {
    const refunded = originalItems.map((item) => ({
      ...item,
      fulfillment_data: { fulfillmentQuantity: 0 },
    }));
    await expect(
      bookOrderShipment(client(legacyQuoteItems, refunded), 'merchant', 'order')
    ).rejects.toMatchObject({ code: 'NO_SHIPPABLE_ITEMS' });
    expect(mocks.book).not.toHaveBeenCalled();
  });
});
