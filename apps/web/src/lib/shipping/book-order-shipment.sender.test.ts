import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSettledRetentionSelectChain,
  prepaidGiglCustomerCheckoutPayment,
} from './book-order-shipment.refresh-fixtures.test-helper';

type OrderShipmentBookingUtilsModule =
  typeof import('@/lib/shipping/order-shipment-booking-utils');

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    getProviderQuotes: vi.fn(),
    bookShipment: vi.fn(),
  },
}));

vi.mock(
  '@/lib/shipping/order-shipment-booking-utils',
  async (importOriginal) => {
    const actual = await importOriginal<OrderShipmentBookingUtilsModule>();
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

const quoteSender = {
  name: 'Merchant',
  phone: '08000000002',
  address: '2 Olaide Tomori Street, Ikeja, 100001',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
  postalCode: '100001',
};

function createSupabase(
  merchantResult: { data: unknown; error: unknown } = {
    data: {
      business_name: 'Merchant',
      business_address: '2 Olaide Tomori Street, Ikeja, 100001',
      phone: '08000000002',
      registered_address: {
        city: 'Ikeja',
        postal_code: '100001',
        state: null,
        street: '2 Olaide Tomori Street',
      },
      state_code: 'LA',
    },
    error: null,
  }
) {
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
    provider_rate_id: 'GIGL_4_0_1_0_0_4',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    quote_request: {
      sessionId: 'session-1',
      shipmentType: 'domestic',
      sender: quoteSender,
      receiver: {
        ...order.shipping_address,
        latitude: 6.5,
        longitude: 3.3,
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
    single: vi.fn().mockResolvedValue(merchantResult),
  };
  const update = { error: null, eq: vi.fn().mockReturnThis() };
  const insertSelect = {
    single: vi
      .fn()
      .mockResolvedValue({ data: { id: 'shipment-1' }, error: null }),
  };

  return {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: vi.fn((table: string) => {
      if (table === 'orders') return { select: vi.fn(() => orderSelect) };
      if (table === 'shipments') {
        return {
          select: vi.fn(() => existingShipmentSelect),
          insert: vi.fn(() => ({ select: vi.fn(() => insertSelect) })),
        };
      }
      if (table === 'shipping_quotes') {
        return {
          select: vi.fn(() => quoteSelect),
          update: vi.fn(() => update),
        };
      }
      if (table === 'merchants') return { select: vi.fn(() => merchantSelect) };
      if (table === 'merchant_settlements') {
        return { select: vi.fn(() => createSettledRetentionSelectChain()) };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  } as never;
}

describe('bookOrderShipment sender selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shippingService.getProviderQuotes).mockResolvedValue([
      {
        id: 'current',
        provider: 'GIGL',
        serviceTier: 'GoStandard',
        carrierName: 'GIG Logistics',
        displayName: 'GIG Logistics',
        price: 2500,
        currency: 'NGN',
        providerCost: 2000,
        platformMargin: 500,
        pricingVersion: 'gigl_platform_margin_v1',
        estimatedDays: 3,
        pickupIncluded: true,
        insuranceIncluded: false,
        providerRateId: 'GIGL_4_0_1_0_0_4',
        expiresAt: new Date('2099-01-01'),
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
  });

  it('uses the server-resolved sender when saved sender contacts match', async () => {
    await bookOrderShipment(createSupabase(), 'merchant-1', 'order-1');

    expect(shippingService.bookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        sender: expect.objectContaining({
          name: 'Merchant',
          phone: '08000000002',
          city: 'Ikeja',
          state: 'Lagos',
          postalCode: '100001',
          country: 'Nigeria',
          countryCode: 'NG',
        }),
      })
    );
  });

  it('surfaces merchant lookup failures as retryable server errors', async () => {
    const booking = bookOrderShipment(
      createSupabase({
        data: null,
        error: { message: 'database unavailable' },
      }),
      'merchant-1',
      'order-1'
    );

    await expect(booking).rejects.toMatchObject({
      code: 'MERCHANT_LOOKUP_FAILED',
      status: 500,
    });
  });
});
