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
  supabase: ReturnType<typeof createSupabaseRpcMock>,
  user: { email_confirmed_at?: string | null } = {
    email_confirmed_at: '2026-01-01T00:00:00Z',
  }
) {
  mockAuthenticateApiRequest.mockResolvedValue({
    error: null,
    supabase,
    user: { email: 'basseybjohn@yahoo.co.uk', id: 'user-1', ...user },
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
      user: {
        email: 'basseybjohn@yahoo.co.uk',
        id: 'user-1',
        email_confirmed_at: '2026-01-01T00:00:00Z',
      },
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

  it('rejects unverified users before calling either redeem RPC', async () => {
    const supabase = createSupabaseRpcMock({
      data: { redirectPath: '/receipts', status: 'ok' },
      error: null,
    });
    mockAuthenticatedSupabase(supabase, { email_confirmed_at: null });

    const response = await POST(postRequest(), params);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Verify your email address before claiming this receipt',
      code: 'EMAIL_UNVERIFIED',
    });
    // The pre-deploy v2 validates only the JWT email, so the gate must run
    // before the call — a missing-function check alone never triggers.
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('falls back to legacy redemption for verified users during rollout', async () => {
    const supabase = createSupabaseRpcMock({ data: null, error: null });
    supabase.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: '42883', message: 'function does not exist' },
      })
      .mockResolvedValueOnce({
        data: { redirectPath: '/receipts', status: 'ok' },
        error: null,
      });
    mockAuthenticatedSupabase(supabase, {
      email_confirmed_at: '2026-01-01T00:00:00Z',
    });

    const response = await POST(postRequest(), params);

    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(supabase.rpc).toHaveBeenNthCalledWith(
      2,
      'redeem_receipt_claim',
      expect.anything()
    );
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
