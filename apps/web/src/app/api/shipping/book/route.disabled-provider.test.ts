import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';
import { shippingQuoteEnvTestMock } from '@/lib/shipping/shipping-quote-env.test-mock';

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>();
  return { ...actual, ...shippingQuoteEnvTestMock };
});

const mockCheckCsrfProtection = vi.fn();
const mockCookies = vi.fn();
const mockCreateClient = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();
const mockHasPermission = vi.fn();
const mockBookShipment = vi.fn();

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
  },
}));

function buildBookingRequest(): NextRequest {
  return new Request('https://usebaci.com/api/shipping/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: '11111111-1111-4111-8111-111111111111',
      carrierId: 'TOPSHIP',
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
        phone: '+14165550123',
        address: '999 New Address',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
        countryCode: 'NG',
      },
      items: [{ name: 'Phone', quantity: 1, weight: 1, value: 500000 }],
    }),
  }) as unknown as NextRequest;
}

function buildSupabaseMock() {
  const ordersSelectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        merchant_id: 'merchant-1',
        selected_quote_id: '22222222-2222-4222-8222-222222222222',
        shipping_status: 'pending',
        shipping_address: {
          address: '999 New Address',
          city: 'Lagos',
          state: 'Lagos',
          country: 'Nigeria',
          countryCode: 'NG',
        },
        order_items: [{ name: 'Phone', quantity: 1, price: 500000 }],
      },
      error: null,
    }),
  };
  const quotesSelectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: '22222222-2222-4222-8222-222222222222',
        provider: 'TOPSHIP',
        provider_rate_id: 'TOPSHIP_RATE_1',
        provider_metadata: {},
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        price: 4500,
        currency: 'NGN',
        estimated_days: 2,
      },
      error: null,
    }),
  };
  const shipmentLookupChain = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  return {
    rpc: vi.fn().mockImplementation((fn: string) => {
      if (fn === 'get_shipping_quote_booking_metadata') {
        return {
          data: {
            serviceType: 'Premium_Express',
            pricingTier: 'International',
          },
          error: null,
        };
      }
      if (fn === 'get_shipping_quote_booking_economics') {
        return {
          data: {
            provider_cost: 3600,
            platform_margin: 900,
            platform_margin_bps: 2000,
            pricing_version: 'gigl_platform_margin_v1',
            shipping_provider_cost: 3600,
            shipping_platform_margin: 900,
            shipping_pricing_version: 'gigl_platform_margin_v1',
          },
          error: null,
        };
      }
      return {
        data: [{ claimed: true, shipment_id: null, tracking_number: null }],
        error: null,
      };
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'orders') {
        return { select: vi.fn(() => ordersSelectChain) };
      }
      if (table === 'shipping_quotes') {
        return { select: vi.fn(() => quotesSelectChain) };
      }
      if (table === 'shipments') {
        return { select: vi.fn(() => shipmentLookupChain) };
      }
      if (table === 'merchants') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                business_name: 'Merchant Store',
                business_address: '1 Merchant Road, Ikeja, Lagos',
                phone: '+2348011111111',
                registered_address: null,
                state_code: 'LA',
              },
              error: null,
            }),
          })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe('POST /api/shipping/book provider errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    mockCookies.mockResolvedValue({});
    mockCreateClient.mockReturnValue(buildSupabaseMock());
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
      businessName: 'Merchant Store',
    });
    mockHasPermission.mockReturnValue(true);
  });

  it('returns disabled provider booking errors as client errors', async () => {
    mockBookShipment.mockRejectedValue(
      new OrderShipmentBookingError(
        'Provider TOPSHIP is disabled for new shipments',
        400,
        'SHIPPING_PROVIDER_DISABLED'
      )
    );
    const { POST } = await import('./route');

    const response = await POST(buildBookingRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Provider TOPSHIP is disabled for new shipments',
      code: 'SHIPPING_PROVIDER_DISABLED',
    });
  });
});
