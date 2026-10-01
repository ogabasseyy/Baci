import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCsrfProtection } from '@/lib/csrf';
import { createClient } from '@/lib/supabase/server';

const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174001';
const USER_ID = '123e4567-e89b-12d3-a456-426614174002';

vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ hasPermission: vi.fn(() => true) }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn().mockResolvedValue({
    merchantId: MERCHANT_ID,
    staffAccess: {},
  }),
  toUserAccess: vi.fn(() => ({ role: 'owner' })),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn() }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

describe('PATCH /api/notifications/mark-all-read', () => {
  let authUser: { id: string } | null;
  let rpcResult: {
    data: { remaining_unread_count: number; updated_count: number } | null;
    error: { message: string } | null;
  };
  let rpc: ReturnType<typeof vi.fn>;
  const request = () =>
    new Request('http://localhost/api/notifications/mark-all-read', {
      method: 'PATCH',
    }) as unknown as NextRequest;

  beforeEach(() => {
    vi.clearAllMocks();
    authUser = { id: USER_ID };
    rpcResult = {
      data: { updated_count: 2, remaining_unread_count: 0 },
      error: null,
    };
    rpc = vi.fn(() => ({ single: vi.fn().mockResolvedValue(rpcResult) }));
    vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: true });
    vi.mocked(createClient).mockReturnValue({
      auth: {
        getUser: vi.fn(() => Promise.resolve({ data: { user: authUser } })),
      },
      rpc,
    } as unknown as ReturnType<typeof createClient>);
  });

  it('returns 401 before evaluating CSRF for unauthenticated callers', async () => {
    authUser = null;
    const { PATCH } = await import('./route');

    const response = await PATCH(request());

    expect(response.status).toBe(401);
    expect(checkCsrfProtection).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('evaluates CSRF after merchant permission and before the RPC', async () => {
    vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: false });
    const { PATCH } = await import('./route');

    const response = await PATCH(request());

    expect(response.status).toBe(403);
    expect(checkCsrfProtection).toHaveBeenCalledOnce();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the RPC remaining count without materializing recipient rows', async () => {
    const { PATCH } = await import('./route');

    const response = await PATCH(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      updated_count: 2,
      unread_count: 0,
    });
    expect(rpc).toHaveBeenCalledWith(
      'mark_all_visible_merchant_notifications_read_v1',
      { p_merchant_id: MERCHANT_ID }
    );
  });

  it('does not truncate a merchant with more than the default 1000 rows', async () => {
    rpcResult = {
      data: { updated_count: 1001, remaining_unread_count: 0 },
      error: null,
    };
    const { PATCH } = await import('./route');

    const response = await PATCH(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      updated_count: 1001,
      unread_count: 0,
    });
  });

  it('returns 500 when the atomic RPC fails', async () => {
    rpcResult = { data: null, error: { message: 'rpc failure' } };
    const { PATCH } = await import('./route');

    const response = await PATCH(request());

    expect(response.status).toBe(500);
  });
});
