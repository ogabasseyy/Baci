import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashReceiptClaimToken } from '@/lib/import-notifications/receipt-claim-links';

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
  email = 'basseybjohn@yahoo.co.uk'
) {
  mockAuthenticateApiRequest.mockResolvedValue({
    error: null,
    supabase,
    user: { email, id: 'user-1' },
  });
}

function postRequest(headers?: HeadersInit) {
  const requestHeaders = new Headers({ 'Content-Type': 'application/json' });
  if (headers) {
    new Headers(headers).forEach((value, key) => {
      requestHeaders.set(key, value);
    });
  }

  return new NextRequest(
    'http://localhost:3000/api/storefront/receipts/claims/claim-token',
    {
      body: JSON.stringify({}),
      headers: requestHeaders,
      method: 'POST',
    }
  );
}

const params = { params: Promise.resolve({ token: 'claim-token' }) };
const invalidParams = { params: Promise.resolve({ token: 'bad token' }) };

describe('POST /api/storefront/receipts/claims/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsoleError.mockClear();
    mockAuthenticatedSupabase(
      createSupabaseRpcMock({
        data: { redirectPath: '/receipts', status: 'ok' },
        error: null,
      }),
      'BasseyBJohn@Yahoo.co.uk'
    );
    mockCheckCsrfProtection.mockResolvedValue({ response: null, valid: true });
  });

  it('requires authentication before redeeming a claim', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      error: 'Not authenticated',
      supabase: null,
      user: null,
    });

    const response = await POST(postRequest(), params);

    expect(response.status).toBe(401);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid redeem tokens before calling the redemption RPC', async () => {
    const supabase = createSupabaseRpcMock({
      data: { redirectPath: '/receipts', status: 'ok' },
      error: null,
    });
    mockAuthenticatedSupabase(supabase);

    const response = await POST(postRequest(), invalidParams);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid receipt claim link' });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('rejects redeem when the signed-in email does not match the claim', async () => {
    const supabase = createSupabaseRpcMock({
      data: { status: 'email_mismatch' },
      error: null,
    });
    mockAuthenticatedSupabase(supabase, 'someoneelse@example.com');

    const response = await POST(postRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'Sign in with the email address that received this receipt link',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('redeem_receipt_claim_v2', {
      p_source: 'web',
      p_token_hash: hashReceiptClaimToken('claim-token'),
    });
  });

  it('returns 409 when the claim was redeemed by a different user', async () => {
    const supabase = createSupabaseRpcMock({
      data: { status: 'already_used' },
      error: null,
    });
    mockAuthenticatedSupabase(supabase);

    const response = await POST(postRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: 'Receipt claim link has already been used',
    });
  });

  it('asks an unverified account to verify its email without linking the purchase', async () => {
    const supabase = createSupabaseRpcMock({
      data: { status: 'email_unverified' },
      error: null,
    });
    mockAuthenticatedSupabase(supabase);
    const response = await POST(postRequest(), params);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Verify your email address before claiming this receipt',
      code: 'EMAIL_UNVERIFIED',
    });
  });

  it('redeems a verified customer claim through the database RPC', async () => {
    const supabase = createSupabaseRpcMock({
      data: { redirectPath: '/receipts', status: 'ok' },
      error: null,
    });
    mockAuthenticatedSupabase(supabase);

    const response = await POST(postRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      redirectPath: '/receipts',
      success: true,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('redeem_receipt_claim_v2', {
      p_source: 'web',
      p_token_hash: hashReceiptClaimToken('claim-token'),
    });
  });

  it('skips CSRF validation for bearer-authenticated mobile redemptions', async () => {
    const supabase = createSupabaseRpcMock({
      data: { redirectPath: '/receipts', status: 'ok' },
      error: null,
    });
    mockAuthenticatedSupabase(supabase);

    const response = await POST(
      postRequest({ Authorization: 'Bearer mobile-session-token' }),
      params
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      redirectPath: '/receipts',
      success: true,
    });
    expect(mockCheckCsrfProtection).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith('redeem_receipt_claim_v2', {
      p_source: 'app',
      p_token_hash: hashReceiptClaimToken('claim-token'),
    });
  });

  it('treats lowercase bearer authorization as mobile redemption', async () => {
    const supabase = createSupabaseRpcMock({
      data: { redirectPath: '/receipts', status: 'ok' },
      error: null,
    });
    mockAuthenticatedSupabase(supabase);

    const response = await POST(
      postRequest({ Authorization: 'bearer mobile-session-token' }),
      params
    );

    expect(response.status).toBe(200);
    expect(mockCheckCsrfProtection).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith('redeem_receipt_claim_v2', {
      p_source: 'app',
      p_token_hash: hashReceiptClaimToken('claim-token'),
    });
  });

  it('falls back to the legacy redemption RPC when the v2 RPC is absent during rollout', async () => {
    const supabase = {
      rpc: vi
        .fn()
        .mockResolvedValueOnce({
          data: null,
          error: {
            code: 'PGRST202',
            message: 'Could not find function public.redeem_receipt_claim_v2',
          },
        })
        .mockResolvedValueOnce({
          data: { redirectPath: '/receipts', status: 'ok' },
          error: null,
        }),
    };
    mockAuthenticatedSupabase(supabase);

    const response = await POST(postRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      redirectPath: '/receipts',
      success: true,
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'redeem_receipt_claim_v2', {
      p_source: 'web',
      p_token_hash: hashReceiptClaimToken('claim-token'),
    });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, 'redeem_receipt_claim', {
      p_token_hash: hashReceiptClaimToken('claim-token'),
    });
  });

  it('returns 403 when the customer record cannot be linked', async () => {
    const supabase = createSupabaseRpcMock({
      data: { status: 'customer_link_failed' },
      error: null,
    });
    mockAuthenticatedSupabase(supabase);

    const response = await POST(postRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'This receipt link cannot be linked to your account',
    });
    expect(mockConsoleError).not.toHaveBeenCalled();
  });

  it('returns 500 when redemption RPC data is malformed', async () => {
    const supabase = createSupabaseRpcMock({
      data: { status: 'unknown_status' },
      error: null,
    });
    mockAuthenticatedSupabase(supabase);

    const response = await POST(postRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to redeem receipt claim' });
    expect(mockConsoleError).toHaveBeenCalled();
  });

  it('returns CSRF validation responses before redeeming with cookie auth', async () => {
    mockCheckCsrfProtection.mockResolvedValue({
      response: NextResponse.json(
        { error: 'Invalid CSRF token' },
        { status: 403 }
      ),
      valid: false,
    });

    const authSupabase = createSupabaseRpcMock({
      data: { redirectPath: '/receipts', status: 'ok' },
      error: null,
    });
    mockAuthenticatedSupabase(authSupabase);

    const response = await POST(postRequest(), params);

    expect(response.status).toBe(403);
    expect(authSupabase.rpc).not.toHaveBeenCalled();
  });
});
