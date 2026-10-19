import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockAuthenticateApiRequest = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockRpc = vi.fn();
const mockFeaturePlanTier = vi.fn(() => 'pro');

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasBearerAuthScheme: (request: NextRequest) =>
    request.headers.get('Authorization')?.startsWith('Bearer ') ?? false,
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

vi.mock('@/env', () => ({
  getConfiguredAppUrl: vi.fn(() => 'https://usebaci.com'),
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const TICKET_UUID = '00000000-0000-4000-8000-000000000099';
const MERCHANT_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';

function makeRequest(
  headers: HeadersInit = { Authorization: 'Bearer test-token' }
): NextRequest {
  return new NextRequest(
    'http://localhost/api/marketplace/jumia/connect/ticket',
    {
      method: 'POST',
      headers,
    }
  );
}

function createSupabase() {
  return {
    rpc: mockRpc,
    from: vi.fn((table: string) => {
      if (table !== 'merchants') {
        throw new Error(`Unexpected table: ${table}`);
      }

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
    }),
  };
}

function setupAuth() {
  mockAuthenticateApiRequest.mockResolvedValue({
    user: { id: USER_ID },
    supabase: createSupabase(),
    error: null,
  });
  mockGetUserAccess.mockResolvedValue({
    merchantId: MERCHANT_ID,
    role: 'owner',
  });
  mockHasPermission.mockReturnValue(true);
}

function setupRpcCreate() {
  mockRpc.mockResolvedValue({
    data: [
      {
        id: TICKET_UUID,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      },
    ],
    error: null,
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

const { POST } = await import('./route');

describe('POST /api/marketplace/jumia/connect/ticket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeaturePlanTier.mockReturnValue('pro');
  });

  it('returns 401 when not authenticated', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      user: null,
      supabase: null,
      error: 'Unauthorized',
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 404 when merchant not found', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: USER_ID },
      supabase: {},
      error: null,
    });
    mockGetUserAccess.mockResolvedValue(null);

    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
  });

  it('rejects cookie-only authentication because the ticket endpoint is bearer-only', async () => {
    setupAuth();

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 403 when missing integrations:manage permission', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: USER_ID },
      supabase: {},
      error: null,
    });
    mockGetUserAccess.mockResolvedValue({
      merchantId: MERCHANT_ID,
      role: 'staff',
    });
    mockHasPermission.mockReturnValue(false);

    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
  });

  it('returns 402 before creating a ticket when marketplace sync is not enabled', async () => {
    setupAuth();
    mockFeaturePlanTier.mockReturnValue('free');
    setupRpcCreate();

    const res = await POST(makeRequest());

    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toMatchObject({
      code: 'requires_upgrade',
      error: 'Marketplace sync requires Baci Pro',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('creates ticket and returns authUrl on success', async () => {
    setupAuth();
    setupRpcCreate();

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ticket).toBe(TICKET_UUID);
    expect(body.authUrl).toContain('/api/marketplace/jumia/connect');
    expect(body.authUrl).toContain('ticket=');
    expect(body.authUrl).toContain('platform=mobile');
    expect(body.authUrl).toContain('connectionType=oauth');
  });

  it('returns 500 when database insert fails', async () => {
    setupAuth();
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Database error' },
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to create ticket');
  });

  it('calls the scoped RPC with the merchant and a 60s TTL', async () => {
    setupAuth();
    setupRpcCreate();

    await POST(makeRequest());

    expect(mockRpc).toHaveBeenCalledWith(
      'create_jumia_oauth_handoff_ticket',
      expect.objectContaining({ p_merchant_id: MERCHANT_ID })
    );
    const [, rpcArgs] = mockRpc.mock.calls[0] as [
      string,
      { p_expires_at: string },
    ];
    const expiresAt = new Date(rpcArgs.p_expires_at);
    const now = Date.now();
    expect(expiresAt.getTime()).toBeGreaterThan(now + 50000);
    expect(expiresAt.getTime()).toBeLessThan(now + 70000);
  });
});
