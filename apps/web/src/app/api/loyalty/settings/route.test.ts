import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  checkCsrfProtection,
  hasPermission,
  getMerchantForApiRequest,
  toUserAccess,
} = vi.hoisted(() => ({
  checkCsrfProtection: vi.fn(),
  hasPermission: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
  toUserAccess: vi.fn((context: { role?: string }) => ({
    role: context.role ?? 'owner',
  })),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn(),
  }),
}));

let csrfValid = true;

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection,
}));

vi.mock('@/lib/api-auth', () => ({
  hasPermission,
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest,
  toUserAccess,
}));

let authUser: { id: string } | null = { id: 'user-1' };
let merchantContext: { merchantId: string; role?: string } | null = {
  merchantId: 'merchant-1',
  role: 'owner',
};
let upsertResult: Record<string, unknown> | null = {
  merchant_id: 'merchant-1',
  enabled: true,
};
let upsertError: { message: string } | null = null;

const upsert = vi.fn(() => ({
  select: vi.fn(() => ({
    single: vi.fn(() =>
      Promise.resolve({
        data: upsertError ? null : upsertResult,
        error: upsertError,
      })
    ),
  })),
}));

const createMockSupabase = () => ({
  auth: {
    getUser: vi.fn(() =>
      Promise.resolve({
        data: { user: authUser },
        error: authUser ? null : { message: 'Not authenticated' },
      })
    ),
  },
  from: vi.fn((table: string) => {
    if (table === 'loyalty_settings') {
      return { upsert };
    }
    throw new Error(`Unexpected table: ${table}`);
  }),
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => createMockSupabase()),
}));

import { POST } from './route';

function makeRequest(body?: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/loyalty/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

describe('POST /api/loyalty/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    csrfValid = true;
    checkCsrfProtection.mockImplementation(() =>
      Promise.resolve({
        valid: csrfValid,
        response: csrfValid
          ? null
          : new Response(JSON.stringify({ error: 'CSRF validation failed' }), {
              status: 403,
            }),
      })
    );
    authUser = { id: 'user-1' };
    merchantContext = {
      merchantId: 'merchant-1',
      role: 'owner',
    };
    upsertResult = {
      merchant_id: 'merchant-1',
      enabled: true,
    };
    upsertError = null;
    hasPermission.mockReturnValue(true);
    getMerchantForApiRequest.mockResolvedValue(merchantContext);
  });

  it('returns 401 before CSRF validation when the user is unauthenticated', async () => {
    authUser = null;

    const response = await POST(makeRequest({ enabled: true }));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe('Unauthorized');
    expect(checkCsrfProtection).not.toHaveBeenCalled();
  });

  it('returns 403 when CSRF validation fails after authentication', async () => {
    csrfValid = false;

    const response = await POST(makeRequest({ enabled: true }));
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error).toBe('CSRF validation failed');
    expect(checkCsrfProtection).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the merchant context is missing', async () => {
    getMerchantForApiRequest.mockResolvedValue(null);

    const response = await POST(makeRequest({ enabled: true }));
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe('Merchant not found');
  });

  it('returns 403 when the user lacks edit permission', async () => {
    hasPermission.mockReturnValue(false);

    const response = await POST(makeRequest({ enabled: true }));
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error).toBe('Forbidden');
  });

  it('returns 400 for invalid settings without a merchant lookup', async () => {
    getMerchantForApiRequest.mockClear();

    const response = await POST(makeRequest({ enabled: 'yes' }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('Invalid request body');
    expect(getMerchantForApiRequest).not.toHaveBeenCalled();
  });

  it('returns 500 when persisting settings fails', async () => {
    upsertError = { message: 'db failure' };

    const response = await POST(makeRequest({ enabled: true }));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe('Failed to save settings');
  });

  it('returns 400 for an out-of-range maximum_redemption_percentage', async () => {
    const response = await POST(
      makeRequest({ maximum_redemption_percentage: 0 })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain('maximum_redemption_percentage');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-number maximum_redemption_percentage', async () => {
    const response = await POST(
      makeRequest({ maximum_redemption_percentage: '50' })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain('maximum_redemption_percentage');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns 400 for a cap that rounds to zero at column precision', async () => {
    const response = await POST(
      makeRequest({ maximum_redemption_percentage: 0.001 })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain('maximum_redemption_percentage');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns 400 instead of crashing on a null JSON body', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/loyalty/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      })
    );

    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('persists settings when the request is authenticated and CSRF is valid', async () => {
    const response = await POST(makeRequest({ enabled: true }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.enabled).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant_id: 'merchant-1',
        enabled: true,
      }),
      { onConflict: 'merchant_id' }
    );
  });
});
