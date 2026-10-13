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
let consumedRows: Record<string, unknown>[] = [
  {
    id: 'redemption-1',
    discount_code: 'RDM-ABC123',
    reward_type: 'free_product',
    customer_id: 'customer-1',
    used_at: '2026-10-13T00:00:00.000Z',
  },
];
let consumeError: { message: string } | null = null;

const select = vi.fn(() =>
  Promise.resolve({
    data: consumeError ? null : consumedRows,
    error: consumeError,
  })
);
const chain: Record<string, unknown> = {};
for (const method of ['update', 'eq', 'in', 'ilike', 'or']) {
  chain[method] = vi.fn(() => chain);
}
chain.select = select;

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
    if (table === 'reward_redemptions') {
      return chain;
    }
    throw new Error(`Unexpected table: ${table}`);
  }),
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
    consumedRows = [
      {
        id: 'redemption-1',
        discount_code: 'RDM-ABC123',
        reward_type: 'free_product',
        customer_id: 'customer-1',
        used_at: '2026-10-13T00:00:00.000Z',
      },
    ];
    consumeError = null;
    hasPermission.mockReturnValue(true);
    getMerchantForApiRequest.mockResolvedValue(merchantContext);
    for (const method of ['update', 'eq', 'in', 'ilike', 'or']) {
      (chain[method] as ReturnType<typeof vi.fn>).mockClear();
    }
    select.mockClear();
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
    expect(chain.update).not.toHaveBeenCalled();
  });

  it('returns 400 when the code is missing', async () => {
    const response = await POST(makeRequest({}));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain('code');
    expect(chain.update).not.toHaveBeenCalled();
  });

  it('consumes an unused manual redemption atomically', async () => {
    const response = await POST(makeRequest({ code: 'rdm-abc123' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.discount_code).toBe('RDM-ABC123');
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ used: true })
    );
    expect(chain.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(chain.eq).toHaveBeenCalledWith('used', false);
    expect(chain.in).toHaveBeenCalledWith(
      'reward_type',
      expect.arrayContaining(['free_product'])
    );
  });

  it('returns 404 when nothing matches (unknown or already consumed)', async () => {
    consumedRows = [];

    const response = await POST(makeRequest({ code: 'RDM-UNKNOWN' }));
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toContain('already consumed');
  });

  it('returns 500 when the update fails', async () => {
    consumeError = { message: 'db failure' };

    const response = await POST(makeRequest({ code: 'RDM-ABC123' }));

    expect(response.status).toBe(500);
  });
});
