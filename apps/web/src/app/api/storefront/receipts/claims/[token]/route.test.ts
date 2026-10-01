import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockCreateClient = vi.fn();
const mockConsoleError = vi
  .spyOn(console, 'error')
  .mockImplementation(() => undefined);

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
  getBearerTokenFromRequest: (request: Request) => {
    const authHeader = request.headers.get('Authorization') ?? '';
    const match = authHeader.match(/^\s*bearer\s+(.+?)\s*$/i);
    const token = match?.[1]?.trim();
    return token || null;
  },
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}));

import { POST } from './route';

function createSupabaseRpcMock(response: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(response),
  };
}

function mockAuthenticatedSupabase(
  supabase: ReturnType<typeof createSupabaseRpcMock>
) {
  mockAuthenticateApiRequest.mockResolvedValue({
    error: null,
    supabase,
    user: { email: 'basseybjohn@yahoo.co.uk', id: 'user-1' },
  });
}

function postRequest() {
  return new NextRequest(
    'http://localhost:3000/api/storefront/receipts/claims/claim-token',
    {
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }
  );
}

const params = { params: Promise.resolve({ token: 'claim-token' }) };

describe('POST /api/storefront/receipts/claims/[token] status mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsoleError.mockClear();
    mockAuthenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: createSupabaseRpcMock({
        data: { redirectPath: '/receipts', status: 'ok' },
        error: null,
      }),
      user: { email: 'basseybjohn@yahoo.co.uk', id: 'user-1' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ response: null, valid: true });
  });

  it('returns 404 when the redemption RPC reports a missing claim', async () => {
    const supabase = createSupabaseRpcMock({
      data: { status: 'not_found' },
      error: null,
    });
    mockAuthenticatedSupabase(supabase);

    const response = await POST(postRequest(), params);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Receipt claim link not found',
    });
  });

  it('returns 404 when the redemption RPC returns no data', async () => {
    const supabase = createSupabaseRpcMock({ data: null, error: null });
    mockAuthenticatedSupabase(supabase);

    const response = await POST(postRequest(), params);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Receipt claim link not found',
    });
  });

  it('returns 410 when the claim link has expired', async () => {
    const supabase = createSupabaseRpcMock({
      data: { status: 'expired' },
      error: null,
    });
    mockAuthenticatedSupabase(supabase);

    const response = await POST(postRequest(), params);

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: 'Receipt claim link has expired',
    });
  });

  it('returns 401 when the redemption RPC reports unauthorized', async () => {
    const supabase = createSupabaseRpcMock({
      data: { status: 'unauthorized' },
      error: null,
    });
    mockAuthenticatedSupabase(supabase);

    const response = await POST(postRequest(), params);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 500 when the redemption RPC itself fails', async () => {
    const supabase = createSupabaseRpcMock({
      data: null,
      error: { message: 'connection reset' },
    });
    mockAuthenticatedSupabase(supabase);

    const response = await POST(postRequest(), params);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to redeem receipt claim',
    });
    expect(mockConsoleError).toHaveBeenCalled();
  });
});
