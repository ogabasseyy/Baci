import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shippingQuoteEnvTestMock } from '@/lib/shipping/shipping-quote-env.test-mock';
import { prepaidGiglCustomerCheckoutPayment } from './book-order-shipment.refresh-fixtures.test-helper';

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>();
  return { ...actual, ...shippingQuoteEnvTestMock };
});

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    getProviderQuotes: vi.fn(),
    bookShipment: vi.fn(),
  },
}));

const { bookOrderShipment } = await import('./book-order-shipment');
const { shippingService } = await import('@/lib/shipping');

const savedQuoteRequest = {
  sessionId: 'quote-session-1',
  shipmentType: 'international' as const,
  sender: {
    name: 'Test Store',
    phone: '08098765432',
    address: '789 Quoted Warehouse',
    city: 'Lagos',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
  },
  receiver: {
    name: 'Jane Receiver',
    phone: '08012345678',
    address: '123 Queen Street West',
    city: 'Toronto',
    state: 'Ontario',
    country: 'Canada',
    countryCode: 'CA',
  },
  items: [
    {
      name: 'Phone',
      quantity: 1,
      weight: 1.2,
      value: 100_000,
      hsCode: '851712',
      length: 10,
      width: 8,
      height: 6,
    },
  ],
};

function createSupabase(
  provider: 'GIGL' | 'TOPSHIP' = 'GIGL',
  legacyInternationalQuote = false,
  orderAddress = savedQuoteRequest.receiver
) {
  const order = {
    id: 'order-1',
    customer_name: 'Jane Doe',
    customer_email: 'jane@example.com',
    customer_phone: '08012345678',
    shipping_fee: 2500,
    selected_quote_id: 'quote-1',
    shipping_provider: provider,
    ...(provider === 'GIGL' ? prepaidGiglCustomerCheckoutPayment : {}),
    shipping_address: orderAddress,
    order_items: [
      {
        name: 'Phone',
        quantity: 1,
        price: 100_000,
        product: {
          weight_value: 1.2,
          weight_unit: 'kg',
          dimensions: { length: 10, width: 8, height: 6, unit: 'cm' },
          commodity_code: '851712',
        },
      },
    ],
  };
  const quote = {
    id: 'quote-1',
    merchant_id: 'merchant-1',
    provider,
    service_tier: 'International',
    carrier_name: 'GIG Logistics',
    price: 2500,
    currency: 'NGN',
    estimated_days: 7,
    provider_rate_id:
      provider === 'GIGL' ? 'GIGL_INTL_1_2_3_1' : 'Premium_Express',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    quote_request: legacyInternationalQuote
      ? { ...savedQuoteRequest, shipmentType: undefined }
      : savedQuoteRequest,
    provider_metadata: {},
    ...(provider === 'GIGL'
      ? {
          provider_cost: 2000,
          platform_margin: 500,
          platform_margin_bps: 2000,
          pricing_version: 'gigl_platform_margin_v1',
        }
      : {}),
  };
  const orders = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: order, error: null }),
  };
  const quotes = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: quote, error: null }),
  };
  const shipments = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  const merchants = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'origin unavailable' },
    }),
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'orders') return { select: vi.fn(() => orders) };
      if (table === 'shipping_quotes') {
        return {
          select: vi.fn(() => quotes),
          update: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            error: null,
          })),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === 'shipments') {
        return {
          select: vi.fn(() => shipments),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'shipment-1' },
                error: null,
              }),
            })),
          })),
        };
      }
      if (table === 'merchants') return { select: vi.fn(() => merchants) };
      if (table === 'merchant_settlements') {
        const settlementsChain = {
          eq: vi.fn().mockReturnThis(),
          // biome-ignore lint/suspicious/noThenProperty: Supabase query mocks are thenable.
          then: (
            onfulfilled: (value: unknown) => unknown,
            onrejected?: (reason: unknown) => unknown
          ) =>
            Promise.resolve({
              data: [
                {
                  metadata: { retained_shipping_amount: 2500 },
                  status: 'completed',
                },
              ],
              error: null,
            }).then(onfulfilled, onrejected),
        };
        return { select: vi.fn(() => settlementsChain) };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
    rpc: vi.fn().mockImplementation((fn: string) => {
      if (fn === 'get_shipping_quote_booking_metadata') {
        return {
          data:
            provider === 'TOPSHIP'
              ? { serviceType: 'Premium_Express', pricingTier: 'International' }
              : null,
          error: null,
        };
      }
      if (fn === 'get_shipping_quote_booking_economics') {
        return {
          data:
            provider === 'GIGL'
              ? {
                  provider_cost: 1000,
                  platform_margin: 100,
                  platform_margin_bps: 400,
                  pricing_version: 'gigl_platform_margin_v1',
                  shipping_provider_cost: 1000,
                  shipping_platform_margin: 100,
                  shipping_pricing_version: 'gigl_platform_margin_v1',
                  shipping_platform_retained_amount: 2500,
                }
              : null,
          error: null,
        };
      }
      return { data: null, error: null };
    }),
  } as never;
}

describe('bugfix: international fulfillment preserves saved sender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shippingService.bookShipment).mockResolvedValue({
      provider: 'GIGL',
      providerShipmentId: 'prov-ship-1',
      trackingNumber: 'TRK123456',
      carrierName: 'GIG Logistics',
      status: 'booked',
      rawResponse: {},
    });
  });

  it('books with the saved sender when the current merchant origin is unavailable', async () => {
    await bookOrderShipment(createSupabase(), 'merchant-1', 'order-1');

    expect(shippingService.bookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        sender: expect.objectContaining({
          address: '789 Quoted Warehouse',
          country: 'Nigeria',
          countryCode: 'NG',
        }),
        receiver: expect.objectContaining({
          address: '123 Queen Street West',
          country: 'Canada',
          countryCode: 'CA',
        }),
        items: [
          expect.objectContaining({
            height: 6,
            hsCode: '851712',
            length: 10,
            weight: 1.2,
            width: 8,
          }),
        ],
      })
    );
  });

  it('preserves the saved sender for Topship international quotes', async () => {
    vi.mocked(shippingService.bookShipment).mockResolvedValue({
      provider: 'TOPSHIP',
      providerShipmentId: 'prov-ship-2',
      trackingNumber: 'TRK654321',
      carrierName: 'Topship Express',
      status: 'booked',
      rawResponse: {},
    });

    await bookOrderShipment(createSupabase('TOPSHIP'), 'merchant-1', 'order-1');

    expect(shippingService.bookShipment).toHaveBeenCalledWith(
      'TOPSHIP',
      expect.objectContaining({
        sender: expect.objectContaining({
          address: '789 Quoted Warehouse',
          country: 'Nigeria',
          countryCode: 'NG',
        }),
        receiver: expect.objectContaining({
          address: '123 Queen Street West',
          country: 'Canada',
          countryCode: 'CA',
        }),
        items: [
          expect.objectContaining({
            height: 6,
            hsCode: '851712',
            length: 10,
            weight: 1.2,
            width: 8,
          }),
        ],
      })
    );
  });

  it('rejects a Topship international quote saved for another destination', async () => {
    await expect(
      bookOrderShipment(
        createSupabase('TOPSHIP', false, {
          ...savedQuoteRequest.receiver,
          address: '99 Different Street',
        }),
        'merchant-1',
        'order-1'
      )
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_ORDER_MISMATCH',
    });

    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });

  it('honors the GIGL international rate marker when a legacy quote omits shipmentType', async () => {
    await bookOrderShipment(
      createSupabase('GIGL', true),
      'merchant-1',
      'order-1'
    );

    expect(shippingService.bookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        sender: expect.objectContaining({
          address: '789 Quoted Warehouse',
          country: 'Nigeria',
          countryCode: 'NG',
        }),
      })
    );
  });
});
