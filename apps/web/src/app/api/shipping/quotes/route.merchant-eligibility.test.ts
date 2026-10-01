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
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = {}
): NextRequest {
  return new Request('https://usebaci.com/api/shipping/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
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
  it('returns empty quotes with a Nigerian-merchants-only warning for a non-NG merchant', async () => {
    const merchantDetails = {
      business_name: 'Merchant Store',
      business_address: null,
      country: 'IN',
      phone: '+919876543210',
    };
    mockCreateAdminClient.mockReturnValue(
      buildSupabaseMock({ id: 'user-1' }, null, merchantDetails)
    );
    mockCreateServerClient.mockResolvedValue(
      buildSupabaseMock({ id: 'user-1' }, null, merchantDetails)
    );
    const { POST } = await import('./route');

    const response = await POST(buildQuoteRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.quotes).toEqual({ featured: [], all: [] });
    expect(
      json.warnings.some((warning: string) =>
        /Nigerian merchants/i.test(warning)
      )
    ).toBe(true);
    expect(mockGetQuotes).not.toHaveBeenCalled();
  });

  it('suppresses carriers for a published non-NG body-only mobile merchant', async () => {
    mockCreateAdminClient.mockReturnValue(buildSupabaseMock(null));
    mockCreateServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      rpc: vi.fn().mockResolvedValue({
        data: {
          business_name: 'Bengaluru Store',
          business_address: '1 Market Road, Bengaluru',
          phone: '+919876543210',
          country: 'IN',
          state_code: null,
        },
        error: null,
      }),
      from: vi.fn(),
    });
    const { POST } = await import('./route');

    const response = await POST(
      buildQuoteRequest(
        { merchantId: '11111111-1111-4111-8111-111111111111' },
        { 'x-baci-client': 'mobile-storefront' }
      )
    );

    expect(response.status).toBe(200);
    expect(mockGetQuotes).not.toHaveBeenCalled();
  });

  it('still fetches quotes when the merchant country is Nigeria', async () => {
    const merchantDetails = {
      business_name: 'Merchant Store',
      business_address: '1 Merchant Road, Lagos',
      country: 'NG',
      phone: '08012345678',
    };
    mockCreateAdminClient.mockReturnValue(
      buildSupabaseMock({ id: 'user-1' }, null, merchantDetails)
    );
    mockCreateServerClient.mockResolvedValue(
      buildSupabaseMock({ id: 'user-1' }, null, merchantDetails)
    );
    const { POST } = await import('./route');

    const response = await POST(buildQuoteRequest());

    expect(response.status).toBe(200);
    expect(mockGetQuotes).toHaveBeenCalled();
  });

  it('still fetches quotes when the merchant country is null', async () => {
    const merchantDetails = {
      business_name: 'Merchant Store',
      business_address: '1 Merchant Road, Lagos',
      country: null,
      phone: '08012345678',
    };
    mockCreateAdminClient.mockReturnValue(
      buildSupabaseMock({ id: 'user-1' }, null, merchantDetails)
    );
    mockCreateServerClient.mockResolvedValue(
      buildSupabaseMock({ id: 'user-1' }, null, merchantDetails)
    );
    const { POST } = await import('./route');

    const response = await POST(buildQuoteRequest());

    expect(response.status).toBe(200);
    expect(mockGetQuotes).toHaveBeenCalled();
  });

  it('returns empty quotes when the merchant payout currency is not NGN even for an NG merchant', async () => {
    const merchantDetails = {
      business_name: 'Merchant Store',
      business_address: '1 Merchant Road, Lagos',
      country: 'NG',
      payout_currency: 'GHS',
      phone: '08012345678',
    };
    mockCreateAdminClient.mockReturnValue(
      buildSupabaseMock({ id: 'user-1' }, null, merchantDetails)
    );
    mockCreateServerClient.mockResolvedValue(
      buildSupabaseMock({ id: 'user-1' }, null, merchantDetails)
    );
    const { POST } = await import('./route');

    const response = await POST(buildQuoteRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.quotes).toEqual({ featured: [], all: [] });
    expect(
      json.warnings.some((warning: string) =>
        /Nigerian merchants/i.test(warning)
      )
    ).toBe(true);
    expect(mockGetQuotes).not.toHaveBeenCalled();
  });

  it('returns empty quotes for a non-NGN payout merchant with no country set', async () => {
    const merchantDetails = {
      business_name: 'Merchant Store',
      business_address: '1 Merchant Road, Accra',
      country: null,
      payout_currency: 'GHS',
      phone: '+233201234567',
    };
    mockCreateAdminClient.mockReturnValue(
      buildSupabaseMock({ id: 'user-1' }, null, merchantDetails)
    );
    mockCreateServerClient.mockResolvedValue(
      buildSupabaseMock({ id: 'user-1' }, null, merchantDetails)
    );
    const { POST } = await import('./route');

    const response = await POST(buildQuoteRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.quotes).toEqual({ featured: [], all: [] });
    expect(mockGetQuotes).not.toHaveBeenCalled();
  });
});
