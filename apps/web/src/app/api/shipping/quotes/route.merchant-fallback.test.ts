import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateAdminClient = vi.fn();
const mockCreateServerClient = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();
const mockHasPermission = vi.fn();
const mockGetQuotes = vi.fn();
const FIXED_QUOTE_EXPIRY = '2099-01-01T00:00:00.000Z';

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
  hasPermission: mockHasPermission,
}));

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    getQuotes: mockGetQuotes,
  },
}));

const quoteItems = [
  { hsCode: '851712', name: 'Phone', quantity: 1, value: 100_000, weight: 1 },
];

function buildQuoteRequest(
  overrides: Record<string, unknown> = {}
): NextRequest {
  return new Request('https://usebaci.com/api/shipping/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shipmentType: 'international',
      receiver: {
        name: 'Jane Receiver',
        address: '123 Queen Street West',
        city: 'Toronto',
        state: 'Ontario',
        country: 'Canada',
        countryCode: 'CA',
      },
      items: quoteItems,
      ...overrides,
    }),
  }) as unknown as NextRequest;
}

function buildSupabaseMock(
  user: { id: string } | null = null,
  merchantError: unknown = null,
  merchantDetails: unknown = {
    business_name: 'Merchant Store',
    business_address: '1 Merchant Road, Lagos',
    phone: '08012345678',
  }
) {
  const shippingQuotesTable = {
    upsert: vi.fn().mockResolvedValue({ error: null }),
  };
  const merchantSelect = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: merchantDetails,
      error:
        merchantError ??
        (merchantDetails ? null : { code: 'PGRST116', message: 'No rows' }),
    }),
    maybeSingle: vi.fn().mockResolvedValue({
      data: merchantDetails,
      error: merchantError,
    }),
  };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === 'merchants') {
        return { select: vi.fn(() => merchantSelect) };
      }
      if (table === 'shipping_quotes') {
        return shippingQuotesTable;
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    // Merchant-configured rates RPC: no rates by default, so the historical
    // carrier-only expectations in this suite stay byte-identical.
    rpc: vi.fn().mockResolvedValue({
      data: { locations: [], rates: [], zones: [] },
      error: null,
    }),
  };
}

describe('POST /api/shipping/quotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
      businessName: 'Merchant Store',
    });
    mockGetQuotes.mockResolvedValue({
      quotes: { featured: [], all: [] },
      sessionId: 'session-1',
      expiresAt: FIXED_QUOTE_EXPIRY,
    });
    mockCreateServerClient.mockResolvedValue(buildSupabaseMock(null));
  });
  it('rejects public international quotes without a merchant sender', async () => {
    mockCreateAdminClient.mockReturnValue(buildSupabaseMock(null));
    const { POST } = await import('./route');

    const response = await POST(
      buildQuoteRequest({
        sender: {
          name: 'Caller Supplied Origin',
          phone: '08099999999',
          address: 'Cheap Origin',
          city: 'Aba',
          state: 'Abia',
          country: 'Nigeria',
          countryCode: 'NG',
        },
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Sender is required for international quotes',
    });
    expect(mockGetQuotes).not.toHaveBeenCalled();
  }, 30_000);

  it('allows merchant sender fallback before international quote creation', async () => {
    mockCreateAdminClient.mockReturnValue(buildSupabaseMock({ id: 'user-1' }));
    mockCreateServerClient.mockResolvedValue(
      buildSupabaseMock({ id: 'user-1' })
    );
    const { POST } = await import('./route');

    const response = await POST(buildQuoteRequest());

    expect(response.status).toBe(200);
    expect(mockCreateServerClient).toHaveBeenCalled();
    expect(mockGetQuotes).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: expect.objectContaining({
          name: 'Merchant Store',
          country: 'Nigeria',
          countryCode: 'NG',
        }),
      }),
      []
    );
  });

  it('rejects public international quotes with an arbitrary merchant ID', async () => {
    const supabase = buildSupabaseMock(null);
    mockCreateAdminClient.mockReturnValue(supabase);
    const { POST } = await import('./route');

    const response = await POST(
      buildQuoteRequest({
        merchantId: '11111111-1111-4111-8111-111111111111',
        sender: {
          name: 'Caller Supplied Origin',
          phone: '08099999999',
          address: 'Cheap Origin',
          city: 'Aba',
          state: 'Abia',
          country: 'Nigeria',
          countryCode: 'NG',
        },
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Merchant shipping origin is not configured',
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mockGetQuotes).not.toHaveBeenCalled();
  });

  it('rejects international quote merchant IDs when auth has no merchant context', async () => {
    const supabase = buildSupabaseMock({ id: 'user-1' });
    mockCreateAdminClient.mockReturnValue(supabase);
    mockCreateServerClient.mockResolvedValue(
      buildSupabaseMock({ id: 'user-1' })
    );
    mockGetMerchantForApiRequest.mockResolvedValue(null);
    const { POST } = await import('./route');

    const response = await POST(
      buildQuoteRequest({
        merchantId: '11111111-1111-4111-8111-111111111111',
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Merchant shipping origin is not configured',
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mockGetQuotes).not.toHaveBeenCalled();
  });

  it('stores the resolved authenticated merchant on international quote requests', async () => {
    const supabase = buildSupabaseMock({ id: 'user-1' });
    mockCreateAdminClient.mockReturnValue(supabase);
    mockCreateServerClient.mockResolvedValue(
      buildSupabaseMock({ id: 'user-1' })
    );
    mockGetQuotes.mockResolvedValue({
      quotes: {
        featured: [],
        all: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            provider: 'GIGL',
            serviceTier: 'Standard',
            carrierName: 'GIG Logistics',
            displayName: 'GIG Logistics International',
            estimatedDays: 5,
            price: 25_000,
            currency: 'NGN',
            pickupIncluded: true,
            insuranceIncluded: true,
            providerRateId: 'GIGL_INTL_1_2_3_1',
            expiresAt: new Date(FIXED_QUOTE_EXPIRY),
          },
        ],
      },
      sessionId: 'session-1',
      expiresAt: FIXED_QUOTE_EXPIRY,
    });
    const { POST } = await import('./route');

    const response = await POST(buildQuoteRequest());

    expect(response.status).toBe(200);
    const quotesTable = supabase.from('shipping_quotes') as {
      upsert: ReturnType<typeof vi.fn>;
    };
    expect(quotesTable.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant_id: 'merchant-1',
        quote_request: expect.objectContaining({
          merchantId: 'merchant-1',
        }),
      }),
      { onConflict: 'id' }
    );
  });

  it('returns 500 when merchant sender lookup fails', async () => {
    mockCreateAdminClient.mockReturnValue(buildSupabaseMock({ id: 'user-1' }));
    mockCreateServerClient.mockResolvedValue(
      buildSupabaseMock({ id: 'user-1' }, { message: 'database unavailable' })
    );
    const { POST } = await import('./route');

    const response = await POST(buildQuoteRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to resolve merchant sender',
    });
    expect(mockGetQuotes).not.toHaveBeenCalled();
  });

  it('does not treat a missing authenticated merchant row as a query failure', async () => {
    mockCreateAdminClient.mockReturnValue(buildSupabaseMock({ id: 'user-1' }));
    mockCreateServerClient.mockResolvedValue(
      buildSupabaseMock({ id: 'user-1' }, null, null)
    );
    const { POST } = await import('./route');

    const response = await POST(buildQuoteRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Merchant shipping origin is not configured',
    });
    expect(mockGetQuotes).not.toHaveBeenCalled();
  });
});
