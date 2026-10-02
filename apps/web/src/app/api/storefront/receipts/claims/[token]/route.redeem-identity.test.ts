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

describe('POST /api/storefront/receipts/claims/[token] identity', () => {
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
});
