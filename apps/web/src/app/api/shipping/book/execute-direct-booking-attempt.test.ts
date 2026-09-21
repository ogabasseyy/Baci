import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetMerchantSender = vi.fn();
const mockBookShipment = vi.fn();
const mockResolveQuote = vi.fn();
const mockAssertShippable = vi.fn();

vi.mock('@/lib/shipping', () => ({
  shippingService: { bookShipment: mockBookShipment },
}));

vi.mock('@/lib/shipping/assert-current-shippable-order-payment', () => ({
  assertCurrentOrderPaymentShippable: mockAssertShippable,
}));

vi.mock('@/lib/shipping/resolve-booking-merchant-sender', () => ({
  resolveBookingMerchantSender: mockGetMerchantSender,
}));

vi.mock('./resolve-booking-quote-for-sender', () => ({
  resolveBookingQuoteForSender: mockResolveQuote,
}));

const { executeDirectBookingAttempt } = await import(
  './execute-direct-booking-attempt'
);

const quote = {
  id: 'quote-1',
  merchant_id: 'merchant-1',
  provider: 'GIGL',
  service_tier: 'GoStandard',
  carrier_name: 'GIG Logistics',
  price: 2500,
  currency: 'NGN',
  estimated_days: 2,
  provider_rate_id: 'GIGL_1',
  expires_at: '2099-01-01T00:00:00.000Z',
  quote_request: null,
  provider_metadata: {},
};

const sender = {
  name: 'Registered Merchant',
  phone: '+2348000000000',
  address: '1 Merchant Road',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};

const payload = {
  receiver: {
    name: 'Customer',
    phone: '+2348111111111',
    address: '2 Customer Road',
    city: 'Lagos',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
  },
  items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100 }],
};

const orderItems = [{ name: 'Phone', quantity: 1, price: 100 }];

describe('executeDirectBookingAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertShippable.mockResolvedValue(undefined);
    mockGetMerchantSender.mockResolvedValue({ ok: true, sender });
    mockResolveQuote.mockResolvedValue(quote);
    mockBookShipment.mockResolvedValue({
      provider: 'GIGL',
      providerShipmentId: 'waybill-1',
      trackingNumber: 'waybill-1',
      carrierName: 'GIG Logistics',
      status: 'booked',
      rawResponse: {},
    });
  });

  it('resolves the registered sender before making the provider booking', async () => {
    const result = await executeDirectBookingAttempt({
      supabase: {} as never,
      merchantId: 'merchant-1',
      merchantBusinessName: 'Merchant Store',
      orderId: 'order-1',
      orderItems,
      quote,
      quotePayload: payload,
      usesStoredInternationalSender: false,
      expectedShippingFee: 2500,
    });

    expect(result).toMatchObject({ bookingQuote: quote, senderInfo: sender });
    expect(mockBookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({ orderId: 'order-1', sender })
    );
  });

  it('verifies the payment state immediately before the provider booking', async () => {
    await executeDirectBookingAttempt({
      supabase: {} as never,
      merchantId: 'merchant-1',
      merchantBusinessName: 'Merchant Store',
      orderId: 'order-1',
      orderItems,
      quote,
      quotePayload: payload,
      usesStoredInternationalSender: false,
      expectedShippingFee: 2500,
    });

    expect(mockAssertShippable).toHaveBeenCalledWith(
      expect.anything(),
      'merchant-1',
      'order-1'
    );
    expect(mockAssertShippable.mock.invocationCallOrder[0]).toBeLessThan(
      mockBookShipment.mock.invocationCallOrder[0]
    );
  });

  it('skips the provider booking when the payment state check rejects', async () => {
    mockAssertShippable.mockRejectedValue(new Error('order_refunded'));

    await expect(
      executeDirectBookingAttempt({
        supabase: {} as never,
        merchantId: 'merchant-1',
        merchantBusinessName: 'Merchant Store',
        orderId: 'order-1',
        orderItems,
        quote,
        quotePayload: payload,
        usesStoredInternationalSender: false,
        expectedShippingFee: 2500,
      })
    ).rejects.toThrow('order_refunded');
    expect(mockBookShipment).not.toHaveBeenCalled();
  });

  it('books an expired domestic quote with its refreshed request', async () => {
    mockResolveQuote.mockResolvedValue({
      ...quote,
      id: 'quote-refreshed',
      quote_request: {
        shipmentType: 'domestic',
        sessionId: 'session-refreshed',
        sender,
        receiver: payload.receiver,
        items: payload.items,
      },
    });

    await executeDirectBookingAttempt({
      supabase: {} as never,
      merchantId: 'merchant-1',
      merchantBusinessName: 'Merchant Store',
      orderId: 'order-1',
      orderItems,
      quote,
      quotePayload: payload,
      usesStoredInternationalSender: false,
      expectedShippingFee: 2500,
    });

    expect(mockBookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        quoteId: 'quote-refreshed',
        receiver: payload.receiver,
        items: [
          {
            name: 'Phone',
            description: 'Phone',
            quantity: 1,
            weight: 1,
            value: 100,
          },
        ],
      })
    );
  });

  it.each([
    {
      drift: 'receiver',
      receiver: { ...payload.receiver, address: '9 Stale Quote Road' },
      items: payload.items,
    },
    {
      drift: 'items',
      receiver: payload.receiver,
      items: [{ ...payload.items[0], weight: 0.25 }],
    },
  ])('rejects domestic $drift drift before provider booking', async ({
    receiver,
    items,
  }) => {
    mockResolveQuote.mockResolvedValue({
      ...quote,
      id: 'quote-refreshed',
      quote_request: {
        shipmentType: 'domestic',
        sessionId: 'session-refreshed',
        sender,
        receiver,
        items,
      },
    });

    await expect(
      executeDirectBookingAttempt({
        supabase: {} as never,
        merchantId: 'merchant-1',
        merchantBusinessName: 'Merchant Store',
        orderId: 'order-1',
        orderItems,
        quote,
        quotePayload: payload,
        usesStoredInternationalSender: false,
        expectedShippingFee: 2500,
      })
    ).rejects.toMatchObject({
      code: 'DOMESTIC_QUOTE_ORDER_MISMATCH',
    });

    expect(mockBookShipment).not.toHaveBeenCalled();
  });

  it('uses the stored international sender without querying the current origin', async () => {
    const storedSender = { ...sender, address: '7 Quoted Origin' };

    await executeDirectBookingAttempt({
      supabase: {} as never,
      merchantId: 'merchant-1',
      merchantBusinessName: 'Merchant Store',
      orderId: 'order-1',
      orderItems,
      quote,
      quotePayload: { ...payload, sender: storedSender },
      usesStoredInternationalSender: true,
    });

    expect(mockGetMerchantSender).not.toHaveBeenCalled();
    expect(mockBookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({ sender: storedSender })
    );
  });

  it('submits surviving quantities after a partial refund', async () => {
    const result = await executeDirectBookingAttempt({
      supabase: {} as never,
      merchantId: 'merchant-1',
      merchantBusinessName: 'Merchant Store',
      orderId: 'order-1',
      orderItems: [
        {
          name: 'Phone',
          quantity: 2,
          price: 100,
          fulfillment_data: { fulfillmentQuantity: 1 },
        },
      ],
      quote,
      quotePayload: {
        ...payload,
        items: [{ name: 'Phone', quantity: 2, weight: 1, value: 100 }],
      },
      usesStoredInternationalSender: false,
      expectedShippingFee: 2500,
    });

    const shippable = [
      {
        name: 'Phone',
        description: 'Phone',
        quantity: 1,
        weight: 1,
        value: 100,
      },
    ];
    expect(result.items).toEqual(shippable);
    expect(mockBookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({ items: shippable })
    );
  });

  it('rejects booking when every unit was refunded', async () => {
    await expect(
      executeDirectBookingAttempt({
        supabase: {} as never,
        merchantId: 'merchant-1',
        merchantBusinessName: 'Merchant Store',
        orderId: 'order-1',
        orderItems: [
          {
            name: 'Phone',
            quantity: 1,
            price: 100,
            fulfillment_data: { fulfillmentQuantity: 0 },
          },
        ],
        quote,
        quotePayload: payload,
        usesStoredInternationalSender: false,
        expectedShippingFee: 2500,
      })
    ).rejects.toMatchObject({ code: 'NO_SHIPPABLE_ITEMS' });
    expect(mockBookShipment).not.toHaveBeenCalled();
  });

  it('does not call the provider when merchant sender resolution fails', async () => {
    mockGetMerchantSender.mockResolvedValue({
      ok: false,
      error: 'Merchant shipping origin is not configured.',
      status: 400,
    });

    await expect(
      executeDirectBookingAttempt({
        supabase: {} as never,
        merchantId: 'merchant-1',
        merchantBusinessName: 'Merchant Store',
        orderId: 'order-1',
        orderItems,
        quote,
        quotePayload: payload,
        usesStoredInternationalSender: false,
        expectedShippingFee: 2500,
      })
    ).rejects.toMatchObject({
      code: 'MERCHANT_SENDER_REQUIRED',
      message: 'Merchant shipping origin is not configured.',
    });

    expect(mockBookShipment).not.toHaveBeenCalled();
  });
});
