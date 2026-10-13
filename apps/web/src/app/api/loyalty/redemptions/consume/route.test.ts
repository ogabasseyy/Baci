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
let rpcResult: Record<string, unknown> = {
  success: true,
  redemption_id: 'redemption-1',
  discount_code: 'RDM-ABC123',
  reward_type: 'free_product',
  customer_id: 'customer-1',
  used_at: '2026-10-13T00:00:00.000Z',
};
let rpcError: { message: string } | null = null;

const rpc = vi.fn(() =>
  Promise.resolve({
    data: rpcError ? null : rpcResult,
    error: rpcError,
  })
);

const createMockSupabase = () => ({
  auth: {
    getUser: vi.fn(() =>
      Promise.resolve({
        data: { user: authUser },
        error: authUser ? null : { message: 'Not authenticated' },
      })
    ),
  },
  rpc,
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => createMockSupabase()),
}));

import { POST } from './route';

function makeRequest(body?: Record<string, unknown>) {
  return new NextRequest(
    'http://localhost:3000/api/loyalty/redemptions/consume',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }
  );
}

describe('POST /api/loyalty/redemptions/consume', () => {
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
    merchantContext = { merchantId: 'merchant-1', role: 'owner' };
    rpcResult = {
      success: true,
      redemption_id: 'redemption-1',
      discount_code: 'RDM-ABC123',
      reward_type: 'free_product',
      customer_id: 'customer-1',
      used_at: '2026-10-13T00:00:00.000Z',
    };
    rpcError = null;
    hasPermission.mockReturnValue(true);
    getMerchantForApiRequest.mockResolvedValue(merchantContext);
  });

  it('returns 401 before CSRF validation when unauthenticated', async () => {
    authUser = null;

    const response = await POST(makeRequest({ code: 'RDM-ABC123' }));

    expect(response.status).toBe(401);
    expect(checkCsrfProtection).not.toHaveBeenCalled();
  });

  it('returns 403 when the user lacks edit permission', async () => {
    hasPermission.mockReturnValue(false);

    const response = await POST(makeRequest({ code: 'RDM-ABC123' }));

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 400 when the code is missing', async () => {
    const response = await POST(makeRequest({}));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain('code');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('consumes an unused manual redemption through the RPC', async () => {
    const response = await POST(makeRequest({ code: 'rdm-abc123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual({
      id: 'redemption-1',
      discount_code: 'RDM-ABC123',
      reward_type: 'free_product',
      customer_id: 'customer-1',
      used_at: '2026-10-13T00:00:00.000Z',
    });
    expect(rpc).toHaveBeenCalledWith('consume_loyalty_redemption', {
      p_merchant_id: 'merchant-1',
      p_code: 'rdm-abc123',
    });
  });

  it('returns 404 when the RPC finds nothing (unknown or consumed)', async () => {
    rpcResult = { success: false, error: 'redemption_not_found' };

    const response = await POST(makeRequest({ code: 'RDM-UNKNOWN' }));
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toContain('already consumed');
  });

  it('returns 403 when the RPC denies merchant access', async () => {
    rpcResult = { success: false, error: 'forbidden' };

    const response = await POST(makeRequest({ code: 'RDM-ABC123' }));

    expect(response.status).toBe(403);
  });

  it('returns 500 when the RPC fails', async () => {
    rpcError = { message: 'db failure' };

    const response = await POST(makeRequest({ code: 'RDM-ABC123' }));

    expect(response.status).toBe(500);
  });
});
