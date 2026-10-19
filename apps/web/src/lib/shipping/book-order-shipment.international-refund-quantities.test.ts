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
import { buildOrderGiglQuoteRequest } from './build-order-gigl-quote-request';
import { assertInternationalQuoteMatchesOrder } from './international-quote-order-guard';
import { toInternationalQuoteValidationItemsFromOrder } from './international-shipment-items';

type AssertGiglCustomerCheckoutPrepaidModule =
  typeof import('./assert-gigl-customer-checkout-prepaid');

const receiver = {
  name: 'Customer',
  phone: '08012345678',
  address: '2 Buyer Road',
  city: 'Toronto',
  state: 'Ontario',
  country: 'Canada',
  countryCode: 'CA',
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
    provider_rate_id: 'GIGL_INTL_2_0_0_1',
    quote_request: {
      sessionId: 'order',
      shipmentType: 'international',
      sender: {
        name: 'Store',
        phone: receiver.phone,
        address: '1 Store Road',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
        countryCode: 'NG',
      },
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

describe('international booking preserves original quote quantities after refunds', () => {
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
  it('accepts a complete pre-refund quote but sends and persists surviving units only', async () => {
    await expect(
      bookOrderShipment(client(), 'merchant', 'order')
    ).resolves.toMatchObject({ shipmentId: 'shipment' });
    const items = [
      expect.objectContaining({
        name: 'Phone',
        quantity: 1,
        weight: 1,
        value: 1000,
      }),
    ];
    expect(mocks.book).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({ items })
    );
    expect(mocks.persist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ items })
    );
  });
  it('keeps a new international quote on the producer original-quantity projection', () => {
    const projected = toInternationalQuoteValidationItemsFromOrder(
      originalItems,
      { includeValue: true }
    );
    expect(projected.map(({ quantity }) => quantity)).toEqual([2, 1]);
    expect(() =>
      assertInternationalQuoteMatchesOrder(
        {
          sessionId: 'order',
          shipmentType: 'international',
          receiver,
          items: legacyQuoteItems,
        },
        { shipping_address: receiver, order_items: originalItems }
      )
    ).not.toThrow();
  });
  it('creates a new international quote with original quantities after a partial refund', async () => {
    const items = originalItems.map((item, index) => ({
      ...item,
      product_id: `product-${index}`,
    }));
    const built = await buildOrderGiglQuoteRequest(
      { id: 'order', shipping_address: receiver, order_items: items },
      {
        ...receiver,
        address: '1 Store Road',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
        countryCode: 'NG',
      },
      async () =>
        Object.fromEntries(
          items.map((item) => [
            item.product_id,
            { ...item.product, commodity_code: '851712' },
          ])
        )
    );
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.code);
    expect(built.request.shipmentType).toBe('international');
    expect(built.request.items.map(({ quantity }) => quantity)).toEqual([2, 1]);
    expect(() =>
      assertInternationalQuoteMatchesOrder(built.request, {
        shipping_address: receiver,
        order_items: originalItems,
      })
    ).not.toThrow();
  });
  it.each([
    [{ ...legacyQuoteItems[0], quantity: 1 }],
    [{ ...legacyQuoteItems[0], weight: 2 }, legacyQuoteItems[1]],
    [{ ...legacyQuoteItems[0], value: 999 }, legacyQuoteItems[1]],
    [
      { ...legacyQuoteItems[0], length: 10, width: 5, height: 3 },
      legacyQuoteItems[1],
    ],
    [
      { ...legacyQuoteItems[0], name: 'Different product' },
      legacyQuoteItems[1],
    ],
  ])('rejects changed quote quantity or product/package details: %j', async (...items) => {
    await expect(
      bookOrderShipment(client(items), 'merchant', 'order')
    ).rejects.toMatchObject({ code: 'INTERNATIONAL_QUOTE_ORDER_MISMATCH' });
    expect(mocks.book).not.toHaveBeenCalled();
  });
  it('fails closed when the original quote matches but no units remain', async () => {
    const refunded = originalItems.map((item) => ({
      ...item,
      fulfillment_data: { fulfillmentQuantity: 0 },
    }));
    await expect(
      bookOrderShipment(client(legacyQuoteItems, refunded), 'merchant', 'order')
    ).rejects.toMatchObject({ code: 'NO_SHIPPABLE_ITEMS' });
    expect(mocks.book).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
