import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheckCsrfProtection = vi.fn();
const mockCookies = vi.fn();
const mockCreateClient = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();
const mockHasPermission = vi.fn();
const mockBookShipment = vi.fn();
const mockPrepareDirectBookingAttempt = vi.fn();

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

vi.mock('./prepare-direct-booking-attempt', () => ({
  prepareDirectBookingAttempt: mockPrepareDirectBookingAttempt,
}));

vi.mock('./execute-direct-booking-attempt', () => ({
  executeDirectBookingAttempt: vi.fn(),
}));

vi.mock('./persist-booked-shipment', () => ({
  persistBookedShipment: vi.fn(),
}));

function buildSupabaseMock() {
  const ordersSelectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        merchant_id: 'merchant-1',
        selected_quote_id: '22222222-2222-4222-8222-222222222222',
        shipping_funding_source: 'customer_checkout',
        shipping_provider: 'GIGL',
        shipping_status: 'pending',
        payment_status: 'unpaid',
        payment_method: 'pay_on_delivery',
        shipping_fee: 4500,
        shipping_address: {
          address: '123 Queen Street West',
          city: 'Lagos',
          state: 'Lagos',
          country: 'Nigeria',
          countryCode: 'NG',
        },
        order_items: [
          {
            name: 'Phone',
            quantity: 1,
            price: 500000,
            product: {
              weight_value: 1,
              weight_unit: 'kg',
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
        merchant_id: 'merchant-1',
        provider: 'GIGL',
        provider_rate_id: 'gigl:service-centre:5',
        quote_request: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        price: 4500,
        currency: 'NGN',
        estimated_days: 2,
        provider_cost: 3600,
        platform_margin: 900,
        platform_margin_bps: 2000,
        pricing_version: 'gigl_platform_margin_v1',
      },
      error: null,
    }),
  };

  return {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
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
      items: [{ name: 'Phone', quantity: 1, weight: 1, value: 500000 }],
    }),
  }) as unknown as NextRequest;
}

describe('POST /api/shipping/book GIGL prepaid guard', () => {
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

  it('rejects unpaid pay-on-delivery GIGL customer checkout before claiming', async () => {
    const { POST } = await import('./route');

    const response = await POST(buildBookingRequest());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error:
        'GIGL shipping must be prepaid at checkout or funded from the merchant wallet before booking.',
      code: 'GIGL_REQUIRES_PREPAID_OR_WALLET',
    });
    expect(mockPrepareDirectBookingAttempt).not.toHaveBeenCalled();
    expect(mockBookShipment).not.toHaveBeenCalled();
  });
});
