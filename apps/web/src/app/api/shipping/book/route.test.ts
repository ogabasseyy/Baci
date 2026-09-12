import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  giglBookingEconomicsProjection,
  giglQuoteEconomicsFields,
  prepaidGiglCustomerCheckoutOrderFields,
} from './route.test-fixtures';

function createSettledRetentionEqChain(
  retainedAmount = giglBookingEconomicsProjection.shipping_platform_retained_amount
) {
  const eqSourceId = vi.fn().mockResolvedValue({
    data: [
      {
        metadata: { retained_shipping_amount: retainedAmount },
        status: 'completed',
      },
    ],
    error: null,
  });
  const eqSourceType = vi.fn(() => ({ eq: eqSourceId }));
  const eqMerchant = vi.fn(() => ({ eq: eqSourceType }));
  return { eq: eqMerchant };
}

const mockCheckCsrfProtection = vi.fn();
const mockCookies = vi.fn();
const mockCreateClient = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();
const mockHasPermission = vi.fn();
const mockBookShipment = vi.fn();
const shipmentInsertPayloads: unknown[] = [];

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mockCheckCsrfProtection,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mockGetMerchantForApiRequest,
  toUserAccess: vi.fn((context: unknown) => context),
}));

vi.mock('@/lib/api-auth', () => ({
  hasPermission: mockHasPermission,
}));

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    bookShipment: mockBookShipment,
    getProviderQuotes: vi.fn(),
  },
}));

function buildSupabaseMock(
  options: {
    selectedQuoteId?: string | null;
    provider?: 'GIGL' | 'TOPSHIP';
    bookingMetadata?: unknown;
  } = {}
) {
  const selectedQuoteId =
    options.selectedQuoteId === undefined
      ? '22222222-2222-4222-8222-222222222222'
      : options.selectedQuoteId;
  const provider = options.provider ?? 'GIGL';
  const ordersSelectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        merchant_id: 'merchant-1',
        selected_quote_id: selectedQuoteId,
        ...prepaidGiglCustomerCheckoutOrderFields,
        shipping_status: 'pending',
        shipping_address: {
          address: '123 Queen Street West',
          city: 'Toronto',
          state: 'Ontario',
          country: 'Canada',
          countryCode: 'CA',
          postalCode: 'M5V 3L9',
        },
        order_items: [
          {
            name: 'Phone',
            quantity: 1,
            price: 500000,
            product: {
              weight_value: 1,
              weight_unit: 'kg',
              dimensions: { length: 10, width: 8, height: 6, unit: 'cm' },
              commodity_code: '851712',
            },
          },
        ],
      },
      error: null,
    }),
  };
  const quotesSelectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: '22222222-2222-4222-8222-222222222222',
        provider,
        provider_rate_id: 'gigl:service-centre:5',
        provider_metadata: { stationId: 5 },
        quote_request: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        price: 4500,
        currency: 'NGN',
        estimated_days: 2,
        ...(provider === 'GIGL' ? giglQuoteEconomicsFields : {}),
      },
      error: null,
    }),
  };
  const shipmentInsertSelectChain = {
    single: vi
      .fn()
      .mockResolvedValue({ data: { id: 'shipment-1' }, error: null }),
  };
  const shipmentInsertChain = {
    select: vi.fn().mockReturnValue(shipmentInsertSelectChain),
  };
  const shipmentLookupChain = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  const shippingQuoteUpdateChain = {
    error: null,
    eq: vi.fn(),
  };
  shippingQuoteUpdateChain.eq.mockReturnValue(shippingQuoteUpdateChain);
  const merchantSelectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        business_name: 'Registered Merchant Store',
        business_address: '9 Registered Road, Ikeja, Lagos',
        phone: '+2348012345678',
        registered_address: {
          city: 'Ikeja',
          postal_code: '100001',
          state: 'Lagos',
          street: '9 Registered Road',
        },
        state_code: 'LA',
      },
      error: null,
    }),
  };

  return {
    rpc: vi.fn((functionName: string) =>
      functionName === 'get_shipping_quote_booking_metadata'
        ? Promise.resolve({
            data: options.bookingMetadata ?? null,
            error: null,
          })
        : functionName === 'get_shipping_quote_booking_economics'
          ? Promise.resolve({
              data: giglBookingEconomicsProjection,
              error: null,
            })
          : Promise.resolve({
              data: [
                { claimed: true, shipment_id: null, tracking_number: null },
              ],
              error: null,
            })
    ),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn(() => ordersSelectChain),
          update: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            select: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'order-1' },
                error: null,
              }),
            })),
          })),
        };
      }

      if (table === 'shipping_quotes') {
        return {
          select: vi.fn((columns: string) => {
            expect(columns).toContain('provider,');
            expect(columns).not.toContain('provider_code');
            return quotesSelectChain;
          }),
          update: vi.fn(() => shippingQuoteUpdateChain),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }

      if (table === 'shipments') {
        return {
          insert: vi.fn((payload: unknown) => {
            shipmentInsertPayloads.push(payload);
            return shipmentInsertChain;
          }),
          select: vi.fn(() => shipmentLookupChain),
        };
      }

      if (table === 'merchants') {
        return {
          select: vi.fn(() => merchantSelectChain),
        };
      }

      if (table === 'merchant_settlements') {
        return {
          select: vi.fn(() => createSettledRetentionEqChain()),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function buildBookingRequest(): NextRequest {
  return new Request('https://usebaci.com/api/shipping/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: '11111111-1111-4111-8111-111111111111',
      carrierId: 'GIGL',
      quoteId: '22222222-2222-4222-8222-222222222222',
      sender: {
        name: 'Merchant Store',
        phone: '+2348011111111',
        address: '1 Merchant Road',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
        countryCode: 'NG',
      },
      receiver: {
        name: 'Jane Customer',
        phone: '+2348022222222',
        address: '2 Customer Road',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
        countryCode: 'NG',
      },
      items: [
        {
          name: 'Phone',
          quantity: 1,
          weight: 1,
          value: 500000,
        },
      ],
    }),
  }) as unknown as NextRequest;
}

describe('POST /api/shipping/book', () => {
  beforeEach(() => {
    shipmentInsertPayloads.length = 0;
    vi.clearAllMocks();
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    mockCookies.mockResolvedValue({});
    mockCreateClient.mockReturnValue(buildSupabaseMock());
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
      businessName: 'Merchant Store',
    });
    mockHasPermission.mockReturnValue(true);
    mockBookShipment.mockResolvedValue({
      provider: 'GIGL',
      providerShipmentId: 'GIGL-123',
      trackingNumber: 'GIGL-123',
      carrierName: 'GIG Logistics',
      status: 'booked',
      isStationPickup: true,
      pickupStationName: 'Lekki Service Centre',
      pickupStationAddress: '1 Admiralty Way, Lekki',
      rawResponse: { Waybill: 'GIGL-123' },
    });
  });

  it('persists station-pickup metadata returned by the provider booking', async () => {
    const { POST } = await import('./route');

    const response = await POST(buildBookingRequest());

    expect(response.status).toBe(201);
    expect(shipmentInsertPayloads[0]).toEqual(
      expect.objectContaining({
        is_station_pickup: true,
        station_name: 'Lekki Service Centre',
        station_address: '1 Admiralty Way, Lekki',
      })
    );
  });

  it('passes sanitized Topship metadata when booking a submitted quote before order selection', async () => {
    const supabase = buildSupabaseMock({
      selectedQuoteId: null,
      provider: 'TOPSHIP',
      bookingMetadata: {
        pricingTier: 'Premium',
        serviceType: 'Express',
        cost: 12500,
      },
    });
    mockCreateClient.mockReturnValue(supabase);
    mockBookShipment.mockResolvedValueOnce({
      provider: 'TOPSHIP',
      providerShipmentId: 'TOPSHIP-123',
      trackingNumber: 'TOPSHIP-123',
      carrierName: 'Topship',
      status: 'booked',
      rawResponse: { id: 'TOPSHIP-123' },
    });

    const { POST } = await import('./route');
    const response = await POST(buildBookingRequest());

    expect(response.status).toBe(201);
    expect(mockBookShipment).toHaveBeenCalledWith(
      'TOPSHIP',
      expect.objectContaining({
        quoteId: '22222222-2222-4222-8222-222222222222',
        quoteMetadata: {
          pricingTier: 'Premium',
          serviceType: 'Express',
          cost: 12500,
        },
      })
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_shipping_quote_booking_metadata',
      {
        p_merchant_id: 'merchant-1',
        p_order_id: '11111111-1111-4111-8111-111111111111',
        p_quote_id: '22222222-2222-4222-8222-222222222222',
      }
    );
  });

  it('returns 403 without booking when the merchant cannot fulfill orders', async () => {
    mockHasPermission.mockReturnValue(false);
    const { POST } = await import('./route');

    const response = await POST(buildBookingRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
    expect(mockBookShipment).not.toHaveBeenCalled();
    expect(shipmentInsertPayloads).toEqual([]);
  });
});
