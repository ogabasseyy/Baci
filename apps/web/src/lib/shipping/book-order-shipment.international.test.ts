import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSettledRetentionSelectChain,
  prepaidGiglCustomerCheckoutPayment,
} from './book-order-shipment.refresh-fixtures.test-helper';

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    getProviderQuotes: vi.fn(),
    bookShipment: vi.fn(),
  },
}));

const { bookOrderShipment } = await import('./book-order-shipment');
const { shippingService } = await import('@/lib/shipping');

const order = {
  id: 'order-1',
  customer_name: 'Jane Doe',
  customer_email: 'jane@example.com',
  customer_phone: '08012345678',
  selected_quote_id: 'quote-1',
  shipping_provider: 'GIGL',
  ...prepaidGiglCustomerCheckoutPayment,
  shipping_address: {
    address: '123 Queen Street West',
    city: 'Toronto',
    country: 'Canada',
    countryCode: 'CA',
    postalCode: 'M5V 3L9',
    state: 'Ontario',
    phone: '08012345678',
  },
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

const merchant = {
  business_name: 'Test Store',
  business_address: '456 Market Rd, Lagos',
  phone: '08098765432',
};

const quoteRequest = {
  sessionId: 'quote-session-1',
  shipmentType: 'international',
  sender: {
    name: 'Test Store',
    phone: '08098765432',
    address: '789 Quoted Warehouse',
    city: 'Lagos',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
    postalCode: '100001',
  },
  receiver: {
    name: 'Jane Receiver',
    phone: '',
    email: 'old-recipient@example.com',
    address: '123 Queen Street West',
    city: 'Toronto',
    state: 'Ontario',
    country: 'Canada',
    countryCode: 'CA',
    postalCode: 'M5V 3L9',
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
  savedQuoteRequest: typeof quoteRequest | null,
  onShipmentInsert?: (payload: unknown) => void
) {
  const ordersSelect = {
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
    single: vi.fn().mockResolvedValue({
      data: {
        id: 'quote-1',
        merchant_id: 'merchant-1',
        provider: 'GIGL',
        service_tier: 'International',
        carrier_name: 'GIG Logistics',
        price: 2500,
        currency: 'NGN',
        estimated_days: 7,
        provider_rate_id: 'GIGL_INTL_1_2_3_1',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        quote_request: savedQuoteRequest,
        provider_metadata: {},
        provider_cost: 2000,
        platform_margin: 500,
        platform_margin_bps: 2000,
        pricing_version: 'gigl_platform_margin_v1',
      },
      error: null,
    }),
  };
  const merchantSelect = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: merchant, error: null }),
  };
  const shipmentInsert = {
    select: vi.fn().mockReturnValue({
      single: vi
        .fn()
        .mockResolvedValue({ data: { id: 'shipment-1' }, error: null }),
    }),
  };
  const quoteUpdate = {
    error: null,
    eq: vi.fn(),
  };
  quoteUpdate.eq.mockReturnValue(quoteUpdate);

  return {
    from: vi.fn((table: string) => {
      if (table === 'orders') return { select: vi.fn(() => ordersSelect) };
      if (table === 'shipping_quotes') {
        return {
          select: vi.fn(() => quoteSelect),
          update: vi.fn(() => quoteUpdate),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === 'merchants') return { select: vi.fn(() => merchantSelect) };
      if (table === 'shipments') {
        return {
          select: vi.fn(() => existingShipmentSelect),
          insert: vi.fn((payload: unknown) => {
            onShipmentInsert?.(payload);
            return shipmentInsert;
          }),
        };
      }
      if (table === 'merchant_settlements') {
        return { select: vi.fn(() => createSettledRetentionSelectChain()) };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  } as unknown as Parameters<typeof bookOrderShipment>[0];
}

describe('bookOrderShipment GIGL international quotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the saved quote destination and server-derived item metadata', async () => {
    const insertedShipments: unknown[] = [];
    vi.mocked(shippingService.bookShipment).mockResolvedValue({
      provider: 'GIGL',
      providerShipmentId: 'prov-ship-1',
      trackingNumber: 'TRK123456',
      carrierName: 'GIG Logistics',
      status: 'booked',
      rawResponse: {},
    });

    await bookOrderShipment(
      createSupabase(quoteRequest, (payload) =>
        insertedShipments.push(payload)
      ),
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
          postalCode: '100001',
        }),
        receiver: expect.objectContaining({
          name: 'Jane Doe',
          phone: '08012345678',
          email: 'jane@example.com',
          city: 'Toronto',
          country: 'Canada',
          countryCode: 'CA',
        }),
        items: [
          expect.objectContaining({
            weight: 1.2,
            hsCode: '851712',
            length: 10,
            width: 8,
            height: 6,
            value: 100_000,
          }),
        ],
      })
    );
    expect(insertedShipments[0]).toEqual(
      expect.objectContaining({
        sender_address: expect.objectContaining({
          address: '789 Quoted Warehouse',
          country: 'Nigeria',
          countryCode: 'NG',
          postalCode: '100001',
        }),
        receiver_address: expect.objectContaining({
          name: 'Jane Doe',
          phone: '08012345678',
          email: 'jane@example.com',
          country: 'Canada',
          countryCode: 'CA',
        }),
        items: [
          expect.objectContaining({
            weight: 1.2,
            hsCode: '851712',
            length: 10,
            width: 8,
            height: 6,
            value: 100_000,
          }),
        ],
      })
    );
  });

  it('rejects bookings without the saved quote request', async () => {
    const booking = bookOrderShipment(
      createSupabase(null),
      'merchant-1',
      'order-1'
    );

    await expect(booking).rejects.toThrow('missing its original request');
    await expect(booking).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_REQUEST_MISSING',
      status: 400,
    });
  });

  it('rejects stale international quote destinations before booking', async () => {
    const staleQuoteRequest = {
      ...quoteRequest,
      receiver: {
        ...quoteRequest.receiver,
        city: 'Vancouver',
      },
    };

    const booking = bookOrderShipment(
      createSupabase(staleQuoteRequest),
      'merchant-1',
      'order-1'
    );

    await expect(booking).rejects.toThrow('no longer matches this order');
    await expect(booking).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_ORDER_MISMATCH',
      status: 400,
    });
    expect(shippingService.bookShipment).not.toHaveBeenCalled();
  });
});
