import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shippingQuoteEnvTestMock } from '@/lib/shipping/shipping-quote-env.test-mock';
import {
  createSettledRetentionSelectChain,
  prepaidGiglCustomerCheckoutPayment,
} from './book-order-shipment.refresh-fixtures.test-helper';

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
        name: 'Customer',
        phone: '08000000001',
        address: 'Receiver Road',
        city: 'Abuja',
        state: 'Abuja',
      }),
      toShipmentItems: vi
        .fn()
        .mockReturnValue([
          { name: 'Widget', quantity: 1, weight: 1, value: 5000 },
        ]),
    };
  }
);

const { bookOrderShipment } = await import('./book-order-shipment');
const { shippingService } = await import('@/lib/shipping');

function createSupabase() {
  const order = {
    id: 'order-1',
    customer_name: 'Customer',
    customer_email: 'customer@example.com',
    customer_phone: '08000000001',
    shipping_fee: 2500,
    selected_quote_id: 'quote-1',
    shipping_provider: 'GIGL',
    ...prepaidGiglCustomerCheckoutPayment,
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
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    quote_request: {
      sessionId: 'session-1',
      shipmentType: 'domestic',
      sender: {
        name: 'Old Origin',
        phone: '08000000000',
        address: '1 Old Road, Ikeja, 100001',
        city: 'Ikeja',
        state: 'Ikeja',
        country: 'Nigeria',
        countryCode: 'NG',
      },
      receiver: {
        name: 'Customer',
        phone: '08000000001',
        address: 'Receiver Road',
        city: 'Abuja',
        state: 'Abuja',
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
        business_name: 'Merchant',
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

  return {
    rpc: vi.fn().mockResolvedValue({ error: null }),
    from: vi.fn((table: string) => {
      if (table === 'orders') return { select: vi.fn(() => orderSelect) };
      if (table === 'shipping_quotes') {
        return {
          select: vi.fn(() => quoteSelect),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === 'merchants') return { select: vi.fn(() => merchantSelect) };
      if (table === 'shipments') {
        return {
          select: vi.fn(() => existingShipmentSelect),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
        };
      }
      if (table === 'merchant_settlements') {
        return { select: vi.fn(() => createSettledRetentionSelectChain()) };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  } as never;
}

describe('bugfix: PATCH fulfillment rejects refreshed price changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
      {
        id: 'quote-refreshed',
        provider: 'GIGL',
        serviceTier: 'GoStandard',
        carrierName: 'GIG Logistics',
        displayName: 'GIG Logistics - GoStandard',
        price: 3000,
        currency: 'NGN',
        estimatedDays: 3,
        pickupIncluded: true,
        insuranceIncluded: false,
        providerRateId: 'GIGL_4_0',
        expiresAt: new Date(Date.now() + 86_400_000),
        rawResponse: {},
      },
    ]);
  });

  it('does not book a refreshed quote above the persisted shipping fee', async () => {
    await expect(
      bookOrderShipment(createSupabase(), 'merchant-1', 'order-1')
    ).rejects.toMatchObject({
      code: 'QUOTE_PRICE_CHANGED',
      status: 400,
    });

    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });
});
