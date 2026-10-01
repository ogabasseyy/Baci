import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateAdminClient = vi.fn();
const mockCreateServerClient = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();
const mockGetQuotes = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateServerClient,
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mockGetMerchantForApiRequest,
  toUserAccess: vi.fn((context: unknown) => context),
}));

vi.mock('@/lib/api-auth', () => ({
  hasPermission: vi.fn(() => true),
}));

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    getQuotes: mockGetQuotes,
  },
}));

describe('POST /api/shipping/quotes merchant context RPC failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMerchantForApiRequest.mockResolvedValue(null);
    mockGetQuotes.mockResolvedValue({
      quotes: { featured: [], all: [] },
      sessionId: 'session-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
  });

  it('fails closed and suppresses NGN carriers when the rate RPC errors on the body-only path', async () => {
    // Body-only path (no trusted header/auth), so the route defaulted the
    // merchant currency to NGN and did NOT early-skip carriers. The rate RPC now
    // ERRORS, so getMerchantRateQuotes can resolve neither currency nor country —
    // the route cannot tell whether this merchant is non-NG. It must FAIL CLOSED:
    // suppress the already-fetched Lagos NGN carrier quotes (which /api/orders
    // could otherwise charge in the merchant's unknown currency) and return the
    // merchant-only (empty + unavailable-warning) response.
    const MERCHANT_ID = '22222222-2222-4222-8222-222222222222';

    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const adminClient = {
      from: vi.fn(),
      // RPC failure: no data, no resolved currency/country.
      rpc: vi.fn().mockImplementation((name: string) =>
        name === 'get_storefront_shipping_sender'
          ? {
              data: {
                business_address: '12 MG Road, Mumbai, Maharashtra',
                business_name: 'India Store',
                country: 'IN',
                phone: '+919876543210',
                state_code: 'MH',
              },
              error: null,
            }
          : {
              data: null,
              error: { message: 'permission denied', code: '42501' },
            }
      ),
    };
    mockCreateAdminClient.mockReturnValue(adminClient);
    mockCreateServerClient.mockResolvedValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: null }, error: null }),
      },
      rpc: adminClient.rpc,
    });
    // Carriers return a Lagos NGN quote that must NOT survive the fail-closed.
    mockGetQuotes.mockResolvedValue({
      quotes: {
        featured: [],
        all: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            provider: 'GIGL',
            serviceTier: 'Standard',
            carrierName: 'GIG Logistics',
            displayName: 'GIG Logistics',
            estimatedDays: 3,
            price: 5000,
            currency: 'NGN',
            pickupIncluded: true,
            insuranceIncluded: true,
            expiresAt: new Date(Date.now() + 60_000),
          },
        ],
      },
      sessionId: 'session-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const { POST } = await import('./route');

    const response = await POST(
      new Request('https://usebaci.com/api/shipping/quotes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-baci-client': 'mobile-storefront',
        },
        body: JSON.stringify({
          shipmentType: 'domestic',
          merchantId: MERCHANT_ID,
          supports_merchant_rates: true,
          receiver: {
            name: 'Jane Receiver',
            address: '12 MG Road',
            city: 'Mumbai',
            state: 'Maharashtra',
            country: 'India',
            countryCode: 'IN',
          },
          items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100_000 }],
        }),
      }) as unknown as NextRequest
    );

    const json = await response.json();

    expect(response.status).toBe(200);
    // No carrier quote survives the fail-closed suppression.
    expect(json.quotes.all).toEqual([]);
    expect(
      json.quotes.all.some(
        (quote: { provider: string }) => quote.provider === 'GIGL'
      )
    ).toBe(false);
    // Empty merchant-only response carries the Nigerian-merchants-only warning.
    expect(
      json.warnings.some((warning: string) =>
        /Nigerian merchants only/i.test(warning)
      )
    ).toBe(true);
    // The projected non-NG origin prevents Nigeria-only carrier calls.
    expect(mockGetQuotes).not.toHaveBeenCalled();
    expect(adminClient.from).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});
