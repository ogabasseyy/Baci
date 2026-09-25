import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

let {
  mockRpc,
  mockAuthenticateApiRequest,
  mockExchangeJumiaCode,
  mockFeaturePlanTier,
  mockGetMerchantIdForApiUser,
  mockGetShops,
  mockMarketplaceUpsert,
  mockExistingIntegrations,
  mockExistingIntegrationsError,
} = vi.hoisted(() => {
  return {
    mockRpc: vi.fn(),
    mockAuthenticateApiRequest: vi.fn(),
    mockExchangeJumiaCode: vi.fn(),
    mockFeaturePlanTier: vi.fn(() => 'pro'),
    mockGetMerchantIdForApiUser: vi.fn(),
    mockGetShops: vi.fn(),
    mockMarketplaceUpsert: vi.fn(),
    mockExistingIntegrations: [] as Array<{
      shop_id: string;
      is_active: boolean;
      connection_method: string;
    }>,
    mockExistingIntegrationsError: null as { message: string } | null,
  };
});

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
  getMerchantIdForApiUser: (...args: unknown[]) =>
    mockGetMerchantIdForApiUser(...args),
}));

vi.mock('@/env', () => ({
  getConfiguredAppUrl: vi.fn(() => 'https://usebaci.com'),
  getJumiaClientId: vi.fn(() => 'client-id'),
  getJumiaClientSecret: vi.fn(() => 'client-secret'),
}));

vi.mock('@/lib/jumia/helpers', () => ({
  exchangeJumiaCode: (...args: unknown[]) => mockExchangeJumiaCode(...args),
  JumiaApiError: class JumiaApiError extends Error {
    status: number;
    details?: unknown;
    constructor(status: number, message: string, details?: unknown) {
      super(`Jumia API Error (${status}): ${message}`);
      this.status = status;
      this.details = details;
    }
  },
  getJumiaRedirectUri: vi.fn(
    () => 'https://usebaci.com/api/marketplace/jumia/callback'
  ),
}));

vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: class {
    getShops = mockGetShops;
  },
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const TICKET_ID = '00000000-0000-4000-8000-000000000099';
const MERCHANT_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';

function createMerchantFeatureBuilder() {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: MERCHANT_ID,
            plan_expires_at: null,
            plan_tier: mockFeaturePlanTier(),
            premium_features: [],
          },
          error: null,
        }),
      })),
    })),
  };
}

function createMarketplaceIntegrationsBuilder() {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: mockExistingIntegrations,
          error: mockExistingIntegrationsError,
        }),
      }),
    }),
    upsert: mockMarketplaceUpsert,
  };
}

const mockUserSupabase = {
  rpc: (name: string, args: unknown) =>
    name === 'persist_jumia_oauth_integrations_atomically'
      ? mockMarketplaceUpsert(name, args)
      : mockRpc(name, args),
  from: vi.fn((table: string) =>
    table === 'merchants'
      ? createMerchantFeatureBuilder()
      : createMarketplaceIntegrationsBuilder()
  ),
};

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    'http://localhost/api/marketplace/jumia/connect/exchange',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

function setupAuth() {
  mockAuthenticateApiRequest.mockResolvedValue({
    user: { id: USER_ID },
    supabase: mockUserSupabase,
    error: null,
  });
  mockGetMerchantIdForApiUser.mockResolvedValue(MERCHANT_ID);
}

function setupTicketConsume(success = true) {
  mockRpc.mockResolvedValue({ data: success, error: null });
}

function setupTokenExchange() {
  mockExchangeJumiaCode.mockResolvedValue({
    access_token: 'access-123',
    refresh_token: 'refresh-456',
    expires_in: 3600,
  });
}

function setupShopDiscovery() {
  mockGetShops.mockResolvedValue([
    {
      id: 'shop-1',
      name: 'My Jumia Shop',
      email: 'test@test.com',
      businessClients: [
        {
          name: 'Jumia Nigeria',
          code: 'jumia_ng',
          countryCode: 'NG',
          countryName: 'Nigeria',
          status: 'active',
          shortCode: 'NG',
        },
      ],
    },
  ]);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

const { POST } = await import('./route');

describe('POST /api/marketplace/jumia/connect/exchange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeaturePlanTier.mockReturnValue('pro');
    mockMarketplaceUpsert.mockResolvedValue({ data: true, error: null });
    mockExistingIntegrations.length = 0;
    mockExistingIntegrationsError = null;
  });

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      user: null,
      supabase: null,
      error: 'Unauthorized',
    });

    const res = await POST(makeRequest({ code: 'abc', ticketId: TICKET_ID }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when code is missing', async () => {
    setupAuth();

    const res = await POST(makeRequest({ ticketId: TICKET_ID }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when ticketId is missing', async () => {
    setupAuth();

    const res = await POST(makeRequest({ code: 'abc' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when ticketId is not a valid UUID', async () => {
    setupAuth();

    const res = await POST(
      makeRequest({ code: 'abc', ticketId: 'not-a-uuid' })
    );
    expect(res.status).toBe(400);
  });

  // All three ticket-failure scenarios below use setupTicketConsume(false).
  // The route's atomic UPDATE ... WHERE status='redeemed' AND user_id=? AND
  // merchant_id=? AND expires_at > now() catches every failure mode in a single
  // query — wrong user, wrong status, or expired ticket all produce 0 rows.
  // Separate mocks per scenario would be redundant.

  it('returns 403 when ticket does not match authenticated user', async () => {
    setupAuth();
    setupTicketConsume(false);

    const res = await POST(makeRequest({ code: 'abc', ticketId: TICKET_ID }));
    expect(res.status).toBe(403);
  });

  it('returns 403 when ticket is already exchanged', async () => {
    setupAuth();
    setupTicketConsume(false);

    const res = await POST(makeRequest({ code: 'abc', ticketId: TICKET_ID }));
    expect(res.status).toBe(403);
  });

  it('returns 403 when ticket is redeemed but expired', async () => {
    setupAuth();
    setupTicketConsume(false);

    const res = await POST(makeRequest({ code: 'abc', ticketId: TICKET_ID }));
    expect(res.status).toBe(403);
  });

  it('returns a retryable 503 when the ticket claim RPC fails', async () => {
    setupAuth();
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'database unavailable' },
    });

    const res = await POST(makeRequest({ code: 'abc', ticketId: TICKET_ID }));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      code: 'jumia_oauth_ticket_claim_failed',
    });
  });

  it('returns 402 before consuming the ticket when marketplace sync is not enabled', async () => {
    setupAuth();
    mockFeaturePlanTier.mockReturnValue('free');
    setupTicketConsume(true);
    setupTokenExchange();
    setupShopDiscovery();

    const res = await POST(
      makeRequest({ code: 'valid-code', ticketId: TICKET_ID })
    );

    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toMatchObject({
      code: 'requires_upgrade',
      error: 'Marketplace sync requires Baci Pro',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 200 with shops on successful exchange', async () => {
    setupAuth();
    setupTicketConsume(true);
    setupTokenExchange();
    setupShopDiscovery();

    const res = await POST(
      makeRequest({ code: 'valid-code', ticketId: TICKET_ID })
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.shops).toContain('shop-1');
    expect(mockRpc).toHaveBeenCalledWith(
      'finalize_jumia_oauth_handoff_ticket',
      expect.objectContaining({
        p_merchant_id: MERCHANT_ID,
        p_ticket_id: TICKET_ID,
      })
    );
  });

  it('retries integration upsert and does not release the ticket after a spent code exchange', async () => {
    setupAuth();
    setupTicketConsume(true);
    setupTokenExchange();
    setupShopDiscovery();
    mockMarketplaceUpsert
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'upsert failed' },
      })
      .mockResolvedValueOnce({ data: true, error: null });

    const res = await POST(
      makeRequest({ code: 'valid-code', ticketId: TICKET_ID })
    );

    expect(res.status).toBe(200);
    expect(mockMarketplaceUpsert).toHaveBeenCalledTimes(2);
    expect(mockRpc).not.toHaveBeenCalledWith(
      'release_jumia_oauth_handoff_ticket',
      expect.anything()
    );
    expect(mockRpc).toHaveBeenCalledWith(
      'finalize_jumia_oauth_handoff_ticket',
      expect.objectContaining({
        p_merchant_id: MERCHANT_ID,
        p_ticket_id: TICKET_ID,
      })
    );
  });

  it('keeps the ticket claimed when upsert keeps failing after code exchange', async () => {
    setupAuth();
    setupTicketConsume(true);
    setupTokenExchange();
    setupShopDiscovery();
    mockMarketplaceUpsert.mockResolvedValue({
      data: null,
      error: { message: 'upsert failed' },
    });

    const res = await POST(
      makeRequest({ code: 'valid-code', ticketId: TICKET_ID })
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      code: 'jumia_oauth_persist_failed',
    });
    expect(mockMarketplaceUpsert).toHaveBeenCalledTimes(3);
    expect(mockRpc).not.toHaveBeenCalledWith(
      'release_jumia_oauth_handoff_ticket',
      expect.anything()
    );
  });

  it('returns 200 and persists when exchange omits refresh_token', async () => {
    setupAuth();
    setupTicketConsume(true);
    setupTokenExchange();
    setupShopDiscovery();
    mockExchangeJumiaCode.mockResolvedValue({
      access_token: 'only-access',
      expires_in: 3600,
    });

    const res = await POST(
      makeRequest({ code: 'no-refresh-code', ticketId: TICKET_ID })
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.incomplete).toBeUndefined();
    expect(body.shops).toContain('shop-1');

    expect(mockMarketplaceUpsert).toHaveBeenCalledWith(
      'persist_jumia_oauth_integrations_atomically',
      expect.objectContaining({
        p_integrations: [
          expect.objectContaining({
            access_token: 'only-access',
            connection_method: 'oauth',
            jumia_authorization_id: null,
            refresh_token: null,
            shop_id: 'shop-1',
          }),
        ],
      })
    );
  });

  it('rejects OAuth when the discovered shop is already self-authorized', async () => {
    setupAuth();
    setupTicketConsume(true);
    setupTokenExchange();
    setupShopDiscovery();
    mockExistingIntegrations.push({
      shop_id: 'shop-1',
      is_active: true,
      connection_method: 'self_authorization',
    });

    const res = await POST(
      makeRequest({ code: 'self-auth-shop', ticketId: TICKET_ID })
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      shopIds: ['shop-1'],
      code: 'jumia_oauth_self_authorization_conflict',
    });
    expect(mockMarketplaceUpsert).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalledWith(
      'release_jumia_oauth_handoff_ticket',
      expect.anything()
    );
  });

  it('returns a retryable error and skips persistence when existing integration lookup fails', async () => {
    setupAuth();
    setupTicketConsume(true);
    setupTokenExchange();
    setupShopDiscovery();
    mockExistingIntegrationsError = { message: 'database unavailable' };

    const res = await POST(
      makeRequest({ code: 'existing-lookup-failure', ticketId: TICKET_ID })
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      code: 'jumia_oauth_existing_integrations_lookup_failed',
    });
    expect(mockRpc).not.toHaveBeenCalledWith(
      'claim_jumia_oauth_handoff_ticket',
      expect.anything()
    );
    expect(mockExchangeJumiaCode).not.toHaveBeenCalled();
    expect(mockMarketplaceUpsert).not.toHaveBeenCalled();
  });

  it('returns incomplete when only fallback shop is created', async () => {
    setupAuth();
    setupTicketConsume(true);
    setupTokenExchange();
    mockGetShops.mockResolvedValue([]); // No shops discovered

    const res = await POST(
      makeRequest({ code: 'valid-code', ticketId: TICKET_ID })
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.incomplete).toBe(true);
    expect(body.shops).toEqual([]);
  });

  it('calls exchangeJumiaCode with correct parameters', async () => {
    setupAuth();
    setupTicketConsume(true);
    setupTokenExchange();
    setupShopDiscovery();

    await POST(makeRequest({ code: 'auth-code-123', ticketId: TICKET_ID }));

    expect(mockExchangeJumiaCode).toHaveBeenCalledWith({
      code: 'auth-code-123',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://usebaci.com/api/marketplace/jumia/callback',
    });
  });

  it('returns 500 when Jumia token exchange fails', async () => {
    setupAuth();
    setupTicketConsume(true);
    mockExchangeJumiaCode.mockRejectedValue(new Error('Token exchange failed'));

    const res = await POST(
      makeRequest({ code: 'bad-code', ticketId: TICKET_ID })
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Exchange failed');
    expect(mockRpc).toHaveBeenCalledWith(
      'release_jumia_oauth_handoff_ticket',
      expect.objectContaining({
        p_merchant_id: MERCHANT_ID,
        p_ticket_id: TICKET_ID,
      })
    );
  });

  it('does not log provider token-exchange details', async () => {
    setupAuth();
    setupTicketConsume(true);
    const { JumiaApiError } = await import('@/lib/jumia/helpers');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockExchangeJumiaCode.mockRejectedValue(
      new JumiaApiError(400, 'Token exchange failed', {
        refresh_token: 'secret-refresh-token',
      })
    );

    await POST(makeRequest({ code: 'bad-code', ticketId: TICKET_ID }));

    expect(errorSpy).toHaveBeenCalledWith(
      '[Jumia Exchange] Token exchange failed:',
      { message: 'Jumia API Error (400): Token exchange failed', status: 400 }
    );
    expect(errorSpy.mock.calls.flat()).not.toContain('secret-refresh-token');
    errorSpy.mockRestore();
  });
});
