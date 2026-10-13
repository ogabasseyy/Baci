import { vi } from 'vitest';
import { shippingService } from '@/lib/shipping';

const staleSender = {
  name: 'Ogabassey',
  phone: '08000000000',
  address: '2 Olaide Tomori Street, Ikeja, 100001',
  city: 'Ikeja',
  state: '100001',
  country: 'Nigeria',
  countryCode: 'NG',
};

export const mismatchedCallerSender = {
  ...staleSender,
  address: '2 Olaide Tomori Street, Ikeja, Lagos, 100001',
  city: 'Lagos',
  state: 'Lagos',
};

export const correctedSender = {
  ...staleSender,
  state: 'Lagos',
  postalCode: '100001',
};

export const prepaidGiglCustomerCheckoutPayment = {
  payment_status: 'paid' as const,
  payment_method: 'paystack',
  shipping_funding_source: 'customer_checkout' as const,
  shipping_platform_retained_amount: 2500,
};

/** Thenable PostgREST chain for settled GIGL retention coverage. */
export function createSettledRetentionSelectChain(retainedAmount = 2500): {
  eq: ReturnType<typeof vi.fn>;
  then: (
    onfulfilled: (value: unknown) => unknown,
    onrejected?: (reason: unknown) => unknown
  ) => Promise<unknown>;
} {
  const result = {
    data: [
      {
        metadata: { retained_shipping_amount: retainedAmount },
        status: 'completed',
      },
    ],
    error: null as null,
  };
  const chain: {
    eq: ReturnType<typeof vi.fn>;
    then: (
      onfulfilled: (value: unknown) => unknown,
      onrejected?: (reason: unknown) => unknown
    ) => Promise<unknown>;
  } = {
    eq: vi.fn(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query mocks are thenable.
    then(
      onfulfilled: (value: unknown) => unknown,
      onrejected?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  };
  chain.eq.mockReturnValue(chain);
  return chain;
}

type StoredSender = typeof staleSender | typeof correctedSender;

export function stubShippingService() {
  vi.clearAllMocks();
  vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
    {
      id: 'quote-refreshed',
      provider: 'GIGL',
      serviceTier: 'GoStandard',
      carrierName: 'GIG Logistics',
      displayName: 'GIG Logistics - GoStandard',
      price: 2500,
      currency: 'NGN',
      estimatedDays: 3,
      pickupIncluded: true,
      insuranceIncluded: false,
      providerRateId: 'GIGL_4_0',
      expiresAt: new Date(Date.now() + 86_400_000),
      rawResponse: {},
    },
  ]);
  vi.mocked(shippingService.bookShipment).mockResolvedValue({
    provider: 'GIGL',
    providerShipmentId: 'waybill-1',
    trackingNumber: 'waybill-1',
    carrierName: 'GIG Logistics',
    status: 'booked',
    rawResponse: {},
  });
}

export function createSupabase({
  upsertError = null,
  quoteExpiresAt = new Date(Date.now() - 60_000).toISOString(),
  storedSender = staleSender,
  fundingSource,
}: {
  upsertError?: { message: string } | null;
  quoteExpiresAt?: string;
  storedSender?: StoredSender;
  fundingSource?: 'customer_checkout' | 'merchant_wallet' | null;
} = {}) {
  const order = {
    id: 'order-1',
    customer_name: 'Customer',
    customer_email: 'customer@example.com',
    customer_phone: '08000000001',
    shipping_fee: 2500,
    selected_quote_id: 'quote-1',
    shipping_provider: 'GIGL',
    ...prepaidGiglCustomerCheckoutPayment,
    shipping_funding_source: fundingSource ?? 'customer_checkout',
    shipping_address: {
      address: 'Receiver Road',
      city: 'Abuja',
      state: 'Abuja',
      phone: '08000000001',
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
    expires_at: quoteExpiresAt,
    quote_request: {
      sessionId: 'session-1',
      shipmentType: 'domestic',
      sender: storedSender,
      receiver: {
        ...order.shipping_address,
        name: order.customer_name,
        phone: order.customer_phone,
        country: 'Nigeria',
        countryCode: 'NG',
      },
      items: [{ name: 'Widget', quantity: 1, weight: 1, value: 5000 }],
    },
    provider_metadata: {},
    provider_cost: 2000,
    platform_margin: 500,
    platform_margin_bps: 2000,
    pricing_version: 'gigl_platform_margin_v1',
  };

  const orderSelect = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: order, error: null }),
  };
  const existingShipmentSelect = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  const quoteSelect = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: quote, error: null }),
  };
  const merchantSelect = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        business_name: 'Ogabassey',
        business_address: '2 Olaide Tomori Street, Ikeja, 100001',
        phone: '08000000000',
        registered_address: {
          city: 'Ikeja',
          postal_code: '100001',
          state: null,
          street: '2 Olaide Tomori Street',
        },
        state_code: 'LA',
      },
      error: null,
    }),
  };
  const update = { error: null, eq: vi.fn().mockReturnThis() };
  const insertSelect = {
    single: vi
      .fn()
      .mockResolvedValue({ data: { id: 'shipment-1' }, error: null }),
  };

  return {
    rpc: vi.fn().mockImplementation((fn: string) => {
      if (fn === 'persist_refreshed_order_shipping_quote') {
        return { error: upsertError };
      }
      if (fn === 'get_shipping_quote_booking_economics') {
        return {
          data: {
            provider_cost: quote.provider_cost,
            platform_margin: quote.platform_margin,
            platform_margin_bps: quote.platform_margin_bps,
            pricing_version: quote.pricing_version,
            shipping_provider_cost: quote.provider_cost,
            shipping_platform_margin: quote.platform_margin,
            shipping_pricing_version: quote.pricing_version,
            shipping_platform_retained_amount:
              order.shipping_funding_source === 'customer_checkout'
                ? (order.shipping_platform_retained_amount ?? 2500)
                : 0,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
      if (table === 'orders') {
        return { select: vi.fn((..._args: unknown[]) => orderSelect) };
      }
      if (table === 'shipments') {
        return {
          select: vi.fn((..._args: unknown[]) => existingShipmentSelect),
          insert: vi.fn(() => ({
            select: vi.fn((..._args: unknown[]) => insertSelect),
          })),
        };
      }
      if (table === 'shipping_quotes') {
        return {
          select: vi.fn((..._args: unknown[]) => quoteSelect),
          update: vi.fn(() => update),
          upsert: vi.fn().mockResolvedValue({ error: upsertError }),
        };
      }
      if (table === 'merchants') {
        return { select: vi.fn((..._args: unknown[]) => merchantSelect) };
      }
      if (table === 'merchant_settlements') {
        const settlementsChain = {
          eq: vi.fn().mockReturnThis(),
          // biome-ignore lint/suspicious/noThenProperty: Supabase query mocks are thenable.
          then(
            onfulfilled: (value: unknown) => unknown,
            onrejected?: (reason: unknown) => unknown
          ) {
            return Promise.resolve({
              data: [
                {
                  metadata: {
                    retained_shipping_amount:
                      order.shipping_funding_source === 'customer_checkout'
                        ? (order.shipping_platform_retained_amount ?? 2500)
                        : 0,
                  },
                  status: 'completed',
                },
              ],
              error: null,
            }).then(onfulfilled, onrejected);
          },
        };
        return { select: vi.fn(() => settlementsChain) };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  } as never;
}
