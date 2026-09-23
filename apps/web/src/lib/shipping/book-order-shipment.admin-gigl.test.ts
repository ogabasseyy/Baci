import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettledRetentionSelectChain } from './book-order-shipment.refresh-fixtures.test-helper';

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    bookShipment: vi.fn(),
  },
}));

vi.mock('./refresh-order-shipment-quote', () => ({
  refreshOrderShipmentQuote: vi.fn(async (_supabase, quote) => quote),
}));

const { bookOrderShipment } = await import('./book-order-shipment');
const { shippingService } = await import('@/lib/shipping');

const bookingResult = {
  provider: 'GIGL' as const,
  providerShipmentId: 'prov-ship-1',
  trackingNumber: 'TRK123456',
  carrierName: 'GIG Logistics',
  status: 'booked' as const,
  rawResponse: {},
};

const orderBase = {
  id: 'order-1',
  customer_name: 'Jane Doe',
  customer_email: 'jane@example.com',
  customer_phone: '08012345678',
  shipping_fee: null,
  selected_quote_id: 'quote-1',
  shipping_provider: 'GIGL',
  shipping_funding_source: 'merchant_wallet' as const,
  shipping_address: {
    address: '123 Main St',
    city: 'Lagos',
    state: 'Lagos',
    phone: '08012345678',
  },
  order_items: [{ name: 'Widget', quantity: 2, price: 5000 }],
};

const quoteBase = {
  id: 'quote-1',
  merchant_id: 'merchant-1',
  provider: 'GIGL',
  service_tier: 'standard',
  carrier_name: 'GIG Logistics',
  price: 2500,
  currency: 'NGN',
  estimated_days: 3,
  provider_rate_id: 'GIGL_30_1_1_575_0',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  provider_metadata: { pricingTier: 'Premium' },
};

function createSupabase(order: unknown, quote: unknown) {
  const orderChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: order, error: null }),
  };
  const quoteChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: quote, error: null }),
  };
  const merchantChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        business_name: 'Test Store',
        business_address: '456 Market Rd, Lagos',
        phone: '08098765432',
      },
      error: null,
    }),
  };
  const shipmentInsert = {
    select: vi.fn().mockReturnValue({
      single: vi
        .fn()
        .mockResolvedValue({ data: { id: 'shipment-1' }, error: null }),
    }),
  };
  const quoteUpdate = { eq: vi.fn().mockReturnThis() };
  const shipments = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    insert: vi.fn().mockReturnValue(shipmentInsert),
  };
  return {
    rpc: vi.fn().mockResolvedValue({
      data: quoteBase.provider_metadata,
      error: null,
    }),
    from: vi.fn((table: string) => {
      if (table === 'orders')
        return { select: vi.fn().mockReturnValue(orderChain) };
      if (table === 'shipping_quotes') {
        return {
          select: vi.fn().mockReturnValue(quoteChain),
          update: vi.fn().mockReturnValue(quoteUpdate),
        };
      }
      if (table === 'shipments') return shipments;
      if (table === 'merchants')
        return { select: vi.fn().mockReturnValue(merchantChain) };
      if (table === 'merchant_settlements') {
        return { select: vi.fn(() => createSettledRetentionSelectChain()) };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  } as never;
}

function quoteRequest(receiver: Record<string, unknown>) {
  return {
    sessionId: 'order-1',
    shipmentType: 'domestic',
    admin_order_provenance: 'server_gigl_v1' as const,
    receiver,
    items: [{ name: 'Widget', quantity: 2, weight: 1, value: 5000 }],
  };
}

describe('Admin GIGL order booking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shippingService.bookShipment).mockResolvedValue(bookingResult);
  });

  it('accepts an unweighted manual order attested at 1 kg', async () => {
    const supabase = createSupabase(orderBase, {
      ...quoteBase,
      quote_request: quoteRequest({
        name: 'Jane Doe',
        phone: '08012345678',
        address: '123 Main St',
        city: 'Lagos',
        state: 'Lagos',
      }),
    });

    await expect(
      bookOrderShipment(supabase, 'merchant-1', 'order-1')
    ).resolves.toBeDefined();
    expect(shippingService.bookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        items: [
          {
            name: 'Widget',
            description: 'Widget',
            quantity: 2,
            weight: 1,
            value: 5000,
          },
        ],
      })
    );
  });

  it('preserves coordinate-only Google receiver coordinates in booking', async () => {
    const receiver = {
      name: 'Jane Doe',
      phone: '08012345678',
      address: '123 Main St',
      city: '',
      state: '',
      country: 'Nigeria',
      countryCode: 'NG',
      latitude: 6.6018,
      longitude: 3.3515,
    };
    const supabase = createSupabase(
      {
        ...orderBase,
        shipping_address: {
          ...orderBase.shipping_address,
          city: '',
          state: '',
          latitude: 6.6018,
          longitude: 3.3515,
        },
      },
      { ...quoteBase, quote_request: quoteRequest(receiver) }
    );

    await bookOrderShipment(supabase, 'merchant-1', 'order-1');
    expect(shippingService.bookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        providerRateId: 'GIGL_30_1_1_575_0',
        receiver: expect.objectContaining({
          latitude: 6.6018,
          longitude: 3.3515,
        }),
      })
    );
  });
});
