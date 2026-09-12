import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    getProviderQuotes: vi.fn(),
    bookShipment: vi.fn(),
  },
}));

vi.mock('@/lib/shipping/refresh-order-shipment-quote', async () => ({
  refreshOrderShipmentQuote: vi.fn(async (_supabase, quote) => quote),
}));

vi.mock(
  '@/lib/shipping/order-shipment-booking-utils',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/lib/shipping/order-shipment-booking-utils')
      >();
    return {
      ...actual,
      buildReceiver: vi.fn().mockReturnValue({
        name: 'Jane Doe',
        phone: '08012345678',
        address: '123 Main St',
        city: 'Lagos',
        state: 'Lagos',
      }),
      buildSender: vi.fn().mockReturnValue({
        name: 'Test Store',
        phone: '08098765432',
        address: '456 Market Rd',
        city: 'Lagos',
        state: 'Lagos',
      }),
      toShipmentItems: vi
        .fn()
        .mockReturnValue([{ name: 'Widget', quantity: 2, weight: 1 }]),
    };
  }
);

// Import after mocks are set up
const { bookOrderShipment } = await import('./book-order-shipment');
const { shippingService } = await import('@/lib/shipping');

type MockChain = {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
};

function createMockSupabase(overrides?: {
  order?: { data: unknown; error: unknown };
  existingShipment?: { data: unknown; error: unknown };
  quote?: { data: unknown; error: unknown };
  quoteUpdate?: { error: unknown };
  merchant?: { data: unknown; error: unknown };
  shipmentInsert?: { data: unknown; error: unknown };
  onShipmentInsert?: (payload: unknown) => void;
  settlements?: { data: unknown; error: unknown };
}) {
  const ordersSelectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi
      .fn()
      .mockResolvedValue(
        overrides?.order ?? { data: null, error: { message: 'not configured' } }
      ),
  };
  const shipmentsSelectChain = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(
      overrides?.existingShipment ?? {
        data: null,
        error: null,
      }
    ),
  };
  const shippingQuotesSelectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi
      .fn()
      .mockResolvedValue(
        overrides?.quote ?? { data: null, error: { message: 'not configured' } }
      ),
  };
  const merchantsSelectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(
      overrides?.merchant ?? {
        data: null,
        error: { message: 'not configured' },
      }
    ),
  };

  const shipmentsInsertSelectChain = {
    single: vi.fn().mockResolvedValue(
      overrides?.shipmentInsert ?? {
        data: { id: 'shipment-1' },
        error: null,
      }
    ),
  };
  const shipmentsInsertChain = {
    select: vi.fn().mockReturnValue(shipmentsInsertSelectChain),
  };
  const shippingQuotesUpdateChain = {
    error: overrides?.quoteUpdate?.error ?? null,
    eq: vi.fn(),
  };
  shippingQuotesUpdateChain.eq.mockReturnValue(shippingQuotesUpdateChain);

  const settlementsSelectChain = {
    eq: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query mocks are thenable.
    then(
      onfulfilled: (value: unknown) => unknown,
      onrejected?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(
        overrides?.settlements ?? {
          data: [
            {
              metadata: { retained_shipping_amount: 2500 },
              status: 'completed',
            },
          ],
          error: null,
        }
      ).then(onfulfilled, onrejected);
    },
  };

  const chain: MockChain = {
    rpc: vi.fn().mockImplementation((fn: string) => {
      if (fn === 'get_shipping_quote_booking_metadata') {
        return Promise.resolve({
          data: validQuote.provider_metadata,
          error: null,
        });
      }
      if (fn === 'get_shipping_quote_booking_economics') {
        return Promise.resolve({
          data: {
            provider_cost: 1000,
            platform_margin: 100,
            platform_margin_bps: 400,
            pricing_version: 'gigl_platform_margin_v1',
            shipping_provider_cost: 1000,
            shipping_platform_margin: 100,
            shipping_pricing_version: 'gigl_platform_margin_v1',
            shipping_platform_retained_amount: 2500,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    }),
    from: vi.fn((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn(() => ordersSelectChain),
        };
      }

      if (table === 'shipments') {
        return {
          select: vi.fn(() => shipmentsSelectChain),
          insert: vi.fn((payload: unknown) => {
            overrides?.onShipmentInsert?.(payload);
            return shipmentsInsertChain;
          }),
        };
      }

      if (table === 'shipping_quotes') {
        return {
          select: vi.fn(() => shippingQuotesSelectChain),
          update: vi.fn(() => shippingQuotesUpdateChain),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }

      if (table === 'merchants') {
        return {
          select: vi.fn(() => merchantsSelectChain),
        };
      }

      if (table === 'merchant_settlements') {
        return {
          select: vi.fn(() => settlementsSelectChain),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return chain as unknown as Parameters<typeof bookOrderShipment>[0];
}

const validOrder = {
  id: 'order-1',
  customer_name: 'Jane Doe',
  customer_email: 'jane@example.com',
  customer_phone: '08012345678',
  selected_quote_id: 'quote-1',
  shipping_provider: 'TOPSHIP',
  shipping_address: {
    address: '123 Main St',
    city: 'Lagos',
    state: 'Lagos',
    phone: '08012345678',
  },
  order_items: [{ name: 'Widget', quantity: 2, price: 5000 }],
};

const validQuote = {
  id: 'quote-1',
  merchant_id: 'merchant-1',
  provider: 'TOPSHIP',
  service_tier: 'standard',
  carrier_name: 'Topship Express',
  price: 2500,
  currency: 'NGN',
  estimated_days: 3,
  provider_rate_id: 'rate-1',
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  quote_request: null,
  provider_metadata: {
    pricingTier: 'Premium',
    serviceType: 'Express Plus Shipping',
    cost: 700000,
  },
};

const validMerchant = {
  business_name: 'Test Store',
  business_address: '456 Market Rd, Lagos',
  phone: '08098765432',
};

const bookingResult = {
  provider: 'TOPSHIP' as const,
  providerShipmentId: 'prov-ship-1',
  trackingNumber: 'TRK123456',
  carrierName: 'Topship Express',
  status: 'booked' as const,
  labelUrl: 'https://example.com/label.pdf',
  pickupScheduledAt: new Date('2026-03-25'),
  rawResponse: {},
};

describe('bookOrderShipment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws ORDER_NOT_FOUND when order does not exist', async () => {
    const supabase = createMockSupabase({
      order: { data: null, error: { message: 'not found' } },
    });

    await expect(
      bookOrderShipment(supabase, 'merchant-1', 'nonexistent')
    ).rejects.toThrow(OrderShipmentBookingError);

    await expect(
      bookOrderShipment(supabase, 'merchant-1', 'nonexistent')
    ).rejects.toThrow('Order not found');
  });

  it('throws MISSING_SHIPPING_QUOTE when order has no selected_quote_id', async () => {
    const supabase = createMockSupabase({
      order: {
        data: { ...validOrder, selected_quote_id: null },
        error: null,
      },
    });

    await expect(
      bookOrderShipment(supabase, 'merchant-1', 'order-1')
    ).rejects.toThrow('does not have a saved shipping quote');
  });

  it('throws INVALID_SHIPPING_PROVIDER when provider is not recognized', async () => {
    const supabase = createMockSupabase({
      order: {
        data: { ...validOrder, shipping_provider: 'UNKNOWN_CARRIER' },
        error: null,
      },
    });

    await expect(
      bookOrderShipment(supabase, 'merchant-1', 'order-1')
    ).rejects.toThrow('not configured for provider-backed shipping');
  });

  it('throws MISSING_ORDER_ITEMS when order has no items', async () => {
    const supabase = createMockSupabase({
      order: {
        data: { ...validOrder, order_items: [] },
        error: null,
      },
    });

    await expect(
      bookOrderShipment(supabase, 'merchant-1', 'order-1')
    ).rejects.toThrow('no items');
  });

  it('throws QUOTE_NOT_FOUND when quote does not exist', async () => {
    const supabase = createMockSupabase({
      order: { data: validOrder, error: null },
      quote: { data: null, error: { message: 'not found' } },
    });

    await expect(
      bookOrderShipment(supabase, 'merchant-1', 'order-1')
    ).rejects.toThrow('shipping quote could not be found');
  });

  it('books shipment successfully with valid data', async () => {
    vi.mocked(shippingService.bookShipment).mockResolvedValue(bookingResult);

    const supabase = createMockSupabase({
      order: { data: validOrder, error: null },
      quote: { data: validQuote, error: null },
      merchant: { data: validMerchant, error: null },
      shipmentInsert: { data: { id: 'shipment-1' }, error: null },
    });

    const result = await bookOrderShipment(supabase, 'merchant-1', 'order-1');

    expect(result).toMatchObject({
      shipmentId: 'shipment-1',
      provider: 'TOPSHIP',
      trackingNumber: 'TRK123456',
      carrierName: 'Topship Express',
      quoteId: 'quote-1',
      estimatedDays: 3,
    });

    expect(shippingService.bookShipment).toHaveBeenCalledWith(
      'TOPSHIP',
      expect.objectContaining({
        orderId: 'order-1',
        quoteId: 'quote-1',
        quoteMetadata: validQuote.provider_metadata,
      })
    );
  });

  it('rejects a domestic booking when an attested quote weight differs from the order product', async () => {
    const supabase = createMockSupabase({
      order: {
        data: {
          ...validOrder,
          order_items: [
            {
              name: 'Widget',
              quantity: 2,
              price: 5000,
              product: { weight_value: 1, weight_unit: 'kg' },
            },
          ],
        },
        error: null,
      },
      quote: {
        data: {
          ...validQuote,
          quote_request: {
            sessionId: 'session-1',
            shipmentType: 'domestic',
            receiver: {
              name: 'Jane Doe',
              phone: '08012345678',
              address: '123 Main St',
              city: 'Lagos',
              state: 'Lagos',
              country: 'Nigeria',
              countryCode: 'NG',
            },
            items: [{ name: 'Widget', quantity: 2, weight: 2, value: 5000 }],
          },
        },
        error: null,
      },
      merchant: { data: validMerchant, error: null },
    });

    await expect(
      bookOrderShipment(supabase, 'merchant-1', 'order-1')
    ).rejects.toThrow('saved shipping quote no longer matches this order');
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });

  it.each([
    ['quantity', { quantity: 3, value: 5000 }],
    ['value', { quantity: 2, value: 7000 }],
  ])('rejects a domestic booking when attested item %s changes', async (_field, item) => {
    const supabase = createMockSupabase({
      order: {
        data: {
          ...validOrder,
          order_items: [
            {
              name: 'Widget',
              quantity: 2,
              price: 5000,
              product: { weight_value: 1, weight_unit: 'kg' },
            },
          ],
        },
        error: null,
      },
      quote: {
        data: {
          ...validQuote,
          quote_request: {
            sessionId: 'session-1',
            shipmentType: 'domestic',
            receiver: {
              name: 'Jane Doe',
              phone: '08012345678',
              address: '123 Main St',
              city: 'Lagos',
              state: 'Lagos',
              country: 'Nigeria',
              countryCode: 'NG',
            },
            items: [{ name: 'Widget', ...item, weight: 1 }],
          },
        },
        error: null,
      },
      merchant: { data: validMerchant, error: null },
    });

    await expect(
      bookOrderShipment(supabase, 'merchant-1', 'order-1')
    ).rejects.toThrow('saved shipping quote no longer matches this order');
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });

  it('books domestic items using the attested quote weights', async () => {
    vi.mocked(shippingService.bookShipment).mockResolvedValue(bookingResult);

    const supabase = createMockSupabase({
      order: {
        data: {
          ...validOrder,
          order_items: [
            {
              name: 'Widget',
              quantity: 2,
              price: 5000,
              product: { weight_value: 2.5, weight_unit: 'kg' },
            },
          ],
        },
        error: null,
      },
      quote: {
        data: {
          ...validQuote,
          quote_request: {
            sessionId: 'session-1',
            shipmentType: 'domestic',
            sender: {
              name: 'Test Store',
              phone: '08098765432',
              address: '456 Market Rd',
              city: 'Lagos',
              state: 'Lagos',
              country: 'Nigeria',
              countryCode: 'NG',
            },
            receiver: {
              name: 'Jane Doe',
              phone: '08012345678',
              address: '123 Main St',
              city: 'Lagos',
              state: 'Lagos',
              country: 'Nigeria',
              countryCode: 'NG',
            },
            items: [
              {
                name: 'Widget',
                quantity: 2,
                weight: 2.5,
                value: 5000,
              },
            ],
          },
        },
        error: null,
      },
      merchant: { data: validMerchant, error: null },
      shipmentInsert: { data: { id: 'shipment-1' }, error: null },
    });

    await bookOrderShipment(supabase, 'merchant-1', 'order-1');

    expect(shippingService.bookShipment).toHaveBeenCalledWith(
      'TOPSHIP',
      expect.objectContaining({
        items: [expect.objectContaining({ name: 'Widget', weight: 2.5 })],
      })
    );
  });

  it('rejects a domestic booking when the order receiver changed after quoting', async () => {
    const supabase = createMockSupabase({
      order: { data: validOrder, error: null },
      quote: {
        data: {
          ...validQuote,
          quote_request: {
            sessionId: 'session-1',
            shipmentType: 'domestic',
            sender: {
              name: 'Test Store',
              phone: '08098765432',
              address: '456 Market Rd',
              city: 'Lagos',
              state: 'Lagos',
              country: 'Nigeria',
              countryCode: 'NG',
            },
            receiver: {
              name: 'Jane Doe',
              phone: '08012345678',
              address: '99 Old Address',
              city: 'Lagos',
              state: 'Lagos',
              country: 'Nigeria',
              countryCode: 'NG',
            },
            items: [
              {
                name: 'Widget',
                quantity: 2,
                weight: 1,
                value: 5000,
              },
            ],
          },
        },
        error: null,
      },
      merchant: { data: validMerchant, error: null },
    });

    await expect(
      bookOrderShipment(supabase, 'merchant-1', 'order-1')
    ).rejects.toThrow(
      'The saved shipping quote no longer matches this order destination.'
    );
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });

  it('persists provider station-pickup instructions with the shipment', async () => {
    const insertedShipments: unknown[] = [];
    vi.mocked(shippingService.bookShipment).mockResolvedValue({
      ...bookingResult,
      provider: 'GIGL',
      carrierName: 'GIG Logistics',
      isStationPickup: true,
      pickupStationName: 'Lekki Service Centre',
      pickupStationAddress: '1 Admiralty Way, Lekki',
    });

    const supabase = createMockSupabase({
      order: {
        data: {
          ...validOrder,
          shipping_provider: 'GIGL',
          shipping_funding_source: 'customer_checkout',
          payment_status: 'paid',
          payment_method: 'paystack',
        },
        error: null,
      },
      quote: { data: { ...validQuote, provider: 'GIGL' }, error: null },
      merchant: { data: validMerchant, error: null },
      shipmentInsert: { data: { id: 'shipment-1' }, error: null },
      onShipmentInsert: (payload) => insertedShipments.push(payload),
    });

    await bookOrderShipment(supabase, 'merchant-1', 'order-1');

    expect(insertedShipments[0]).toEqual(
      expect.objectContaining({
        is_station_pickup: true,
        station_name: 'Lekki Service Centre',
        station_address: '1 Admiralty Way, Lekki',
      })
    );
  });

  it('reuses an existing saved shipment instead of booking the provider again', async () => {
    const supabase = createMockSupabase({
      order: { data: validOrder, error: null },
      existingShipment: {
        data: {
          id: 'shipment-existing',
          provider: 'TOPSHIP',
          provider_shipment_id: 'prov-existing',
          tracking_number: 'TRACK-EXISTING',
          carrier_name: 'Topship Express',
          estimated_delivery_days: 2,
          label_url: 'https://example.com/existing-label.pdf',
          pickup_scheduled_at: '2026-03-25T00:00:00.000Z',
          status: 'booked',
        },
        error: null,
      },
    });

    const result = await bookOrderShipment(supabase, 'merchant-1', 'order-1');

    expect(result).toMatchObject({
      shipmentId: 'shipment-existing',
      provider: 'TOPSHIP',
      providerShipmentId: 'prov-existing',
      trackingNumber: 'TRACK-EXISTING',
      quoteId: 'quote-1',
    });
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });

  it('throws when an existing saved shipment is missing critical booking details', async () => {
    const supabase = createMockSupabase({
      order: { data: validOrder, error: null },
      existingShipment: {
        data: {
          id: 'shipment-existing',
          provider: 'TOPSHIP',
          provider_shipment_id: null,
          tracking_number: 'TRACK-EXISTING',
          carrier_name: 'Topship Express',
          estimated_delivery_days: 2,
          label_url: null,
          pickup_scheduled_at: null,
          status: 'booked',
        },
        error: null,
      },
    });

    await expect(
      bookOrderShipment(supabase, 'merchant-1', 'order-1')
    ).rejects.toThrow('shipment is already saved for this order');
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });

  it('throws MERCHANT_NOT_FOUND when merchant does not exist', async () => {
    const supabase = createMockSupabase({
      order: { data: validOrder, error: null },
      quote: { data: validQuote, error: null },
      merchant: { data: null, error: { message: 'not found' } },
    });

    await expect(
      bookOrderShipment(supabase, 'merchant-1', 'order-1')
    ).rejects.toThrow('Merchant details not found');
  });

  it('throws SHIPMENT_SAVE_FAILED when insert fails', async () => {
    vi.mocked(shippingService.bookShipment).mockResolvedValue(bookingResult);

    const supabase = createMockSupabase({
      order: { data: validOrder, error: null },
      quote: { data: validQuote, error: null },
      merchant: { data: validMerchant, error: null },
      shipmentInsert: { data: null, error: { message: 'insert failed' } },
    });

    await expect(
      bookOrderShipment(supabase, 'merchant-1', 'order-1')
    ).rejects.toMatchObject({
      code: 'SHIPMENT_SAVE_FAILED',
      providerReference: bookingResult.providerShipmentId,
    });
  });

  it('returns the shipment when a booked quote cannot be marked used', async () => {
    vi.mocked(shippingService.bookShipment).mockResolvedValue(bookingResult);
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const supabase = createMockSupabase({
      order: { data: validOrder, error: null },
      quote: { data: validQuote, error: null },
      quoteUpdate: { error: { message: 'permission denied' } },
      merchant: { data: validMerchant, error: null },
      shipmentInsert: { data: { id: 'shipment-1' }, error: null },
    });

    const result = await bookOrderShipment(supabase, 'merchant-1', 'order-1');

    expect(result).toEqual(
      expect.objectContaining({
        shipmentId: 'shipment-1',
        provider: bookingResult.provider,
        trackingNumber: bookingResult.trackingNumber,
        quoteId: 'quote-1',
      })
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Shipment booked but quote could not be marked as used',
      expect.objectContaining({
        error: { message: 'permission denied' },
        orderId: 'order-1',
        provider: bookingResult.provider,
        quoteId: 'quote-1',
        trackingNumber: bookingResult.trackingNumber,
      })
    );
    consoleErrorSpy.mockRestore();
  });

  describe('bugfix: GIGL customer checkout requires prepaid shipping', () => {
    it('rejects unpaid pay-on-delivery GIGL bookings before quote lookup', async () => {
      const supabase = createMockSupabase({
        order: {
          data: {
            ...validOrder,
            shipping_provider: 'GIGL',
            shipping_funding_source: 'customer_checkout',
            payment_status: 'unpaid',
            payment_method: 'pay_on_delivery',
          },
          error: null,
        },
      });

      await expect(
        bookOrderShipment(supabase, 'merchant-1', 'order-1')
      ).rejects.toMatchObject({
        code: 'GIGL_REQUIRES_PREPAID_OR_WALLET',
        status: 400,
      });
      expect(supabase.from).not.toHaveBeenCalledWith('shipping_quotes');
      expect(shippingService.bookShipment).not.toHaveBeenCalled();
    });
  });
});
