import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepaidGiglCustomerCheckoutPayment } from './book-order-shipment.refresh-fixtures.test-helper';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/shipping', () => ({
  shippingService: {
    getProviderQuotes: vi.fn(),
    bookShipment: vi.fn(),
  },
}));
vi.mock('@/lib/shipping/find-reusable-order-shipment', () => ({
  findReusableOrderShipment: vi.fn(),
}));
vi.mock('@/lib/shipping/resolve-booking-merchant-sender', () => ({
  resolveBookingMerchantSender: vi.fn(),
}));

const { bookOrderShipment } = await import('./book-order-shipment');
const { shippingService } = await import('@/lib/shipping');
const { findReusableOrderShipment } = await import(
  '@/lib/shipping/find-reusable-order-shipment'
);
const { resolveBookingMerchantSender } = await import(
  '@/lib/shipping/resolve-booking-merchant-sender'
);

type BookingSupabase = Parameters<typeof bookOrderShipment>[0];

function createSupabase(
  rpcError: Error | null = null,
  options: {
    fundingSource?: 'customer_checkout' | 'merchant_wallet';
    onShipmentInsert?: (payload: unknown) => void;
  } = {}
) {
  const order = {
    id: 'order-1',
    customer_name: 'Jane Doe',
    customer_email: 'jane@example.com',
    customer_phone: '08012345678',
    shipping_fee: 2500,
    selected_quote_id: 'quote-1',
    shipping_provider: 'GIGL',
    ...prepaidGiglCustomerCheckoutPayment,
    shipping_funding_source: options.fundingSource ?? 'customer_checkout',
    shipping_provider_cost: 1000,
    shipping_platform_margin: 100,
    shipping_pricing_version: 'gigl_platform_margin_v1',
    shipping_address: {
      address: '123 Main St',
      city: 'Lagos',
      state: 'Lagos',
      phone: '08012345678',
    },
    order_items: [{ name: 'Widget', quantity: 1, price: 5000 }],
  };
  const quote = {
    id: 'quote-1',
    merchant_id: 'merchant-1',
    provider: 'GIGL',
    service_tier: 'GoStandard',
    carrier_name: 'GIG Logistics',
    price: 2500,
    currency: 'NGN',
    estimated_days: 3,
    provider_rate_id: 'GIGL_4_0',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    quote_request: null,
    provider_cost: 1000,
    platform_margin: 100,
    platform_margin_bps: 400,
    pricing_version: 'gigl_platform_margin_v1',
  };
  const shippingQuotesUpdate = {
    eq: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query mocks are thenable.
    then: (resolve: (value: { error: null }) => unknown) =>
      resolve({ error: null }),
  };
  const supabase = {
    rpc: vi.fn((fn: string) => {
      if (fn === 'get_shipping_quote_booking_metadata') {
        return Promise.resolve({
          data: rpcError
            ? null
            : {
                pricingTier: 'Premium',
                serviceType: 'Express',
                cost: 1000,
                providerTariff: 900,
                secretTariff: 'internal-only',
              },
          error: rpcError,
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
      return Promise.resolve({ data: null, error: null });
    }),
    from: vi.fn((table: string) => {
      if (table === 'orders') {
        const chain = {
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: order, error: null }),
        };
        return { select: vi.fn().mockReturnValue(chain) };
      }
      if (table === 'shipping_quotes') {
        const chain = {
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: quote, error: null }),
        };
        return {
          select: vi.fn().mockReturnValue(chain),
          update: vi.fn().mockReturnValue(shippingQuotesUpdate),
        };
      }
      if (table === 'shipments') {
        return {
          insert: vi.fn((payload: unknown) => {
            options.onShipmentInsert?.(payload);
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'shipment-1' },
                  error: null,
                }),
              }),
            };
          }),
        };
      }
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
        return { select: vi.fn().mockReturnValue(settlementsChain) };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
  return { supabase: supabase as unknown as BookingSupabase };
}

describe('GIGL booking economics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findReusableOrderShipment).mockResolvedValue(null);
    vi.mocked(resolveBookingMerchantSender).mockResolvedValue({
      ok: true,
      sender: {
        name: 'Test Store',
        phone: '08098765432',
        address: '456 Market Rd',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
        countryCode: 'NG',
      },
    });
    vi.mocked(shippingService.bookShipment).mockResolvedValue({
      provider: 'GIGL',
      providerShipmentId: 'provider-shipment-1',
      trackingNumber: 'GIGL-TRACK-1',
      carrierName: 'GIG Logistics',
      status: 'booked',
      rawResponse: {},
    });
  });

  it('passes only the sanitized booking projection to GIGL', async () => {
    const { supabase } = createSupabase();

    await bookOrderShipment(supabase, 'merchant-1', 'order-1');

    expect(shippingService.bookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        quoteMetadata: {
          pricingTier: 'Premium',
          serviceType: 'Express',
          cost: 1000,
        },
      })
    );
    const bookingRequest = vi.mocked(shippingService.bookShipment).mock
      .calls[0]?.[1] as { quoteMetadata?: Record<string, unknown> };
    expect(bookingRequest.quoteMetadata).not.toHaveProperty('providerTariff');
    expect(bookingRequest.quoteMetadata).not.toHaveProperty('secretTariff');
  });

  it.each([
    'customer_checkout',
    'merchant_wallet',
  ] as const)('leaves economics stamping to the database trigger for %s bookings', async (fundingSource) => {
    let insertedShipment: unknown;
    const { supabase } = createSupabase(null, {
      fundingSource,
      onShipmentInsert: (payload) => {
        insertedShipment = payload;
      },
    });

    await bookOrderShipment(supabase, 'merchant-1', 'order-1');

    expect(insertedShipment).not.toHaveProperty('provider_cost');
    expect(insertedShipment).not.toHaveProperty('platform_margin');
  });

  it('stops before provider booking when the metadata lookup fails', async () => {
    const { supabase } = createSupabase(new Error('metadata lookup failed'));

    await expect(
      bookOrderShipment(supabase, 'merchant-1', 'order-1')
    ).rejects.toMatchObject({
      code: 'QUOTE_METADATA_LOOKUP_FAILED',
      status: 500,
    });
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });
});
