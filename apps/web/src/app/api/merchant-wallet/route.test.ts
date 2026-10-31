import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserAccess } from '@/lib/api-permissions';

const rpc = vi.fn();
const from = vi.fn();
const authenticateApiRequest = vi.fn();
const getUserAccess = vi.fn();
vi.mock('@/lib/api-auth', async () => {
  const permissions = await vi.importActual<
    typeof import('@/lib/api-permissions')
  >('@/lib/api-permissions');
  return {
    authenticateApiRequest,
    getUserAccess,
    hasPermission: permissions.hasPermission,
  };
});
const { GET } = await import('./route');
const getHandler = GET as (request: NextRequest) => Promise<Response>;
const request = new Request(
  'http://localhost/api/merchant-wallet'
) as unknown as NextRequest;

const owner: UserAccess = {
  merchantId: 'm1',
  role: 'owner',
  isOwner: true,
  isStaff: false,
  permissions: {},
};
function staff(permissions: UserAccess['permissions']): UserAccess {
  return {
    merchantId: 'm1',
    role: 'fulfillment',
    isOwner: false,
    isStaff: true,
    permissions,
  };
}

describe('GET /api/merchant-wallet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateApiRequest.mockResolvedValue({
      user: { id: 'u1' },
      error: null,
      supabase: { from, rpc },
    });
    getUserAccess.mockResolvedValue(owner);
    rpc.mockResolvedValue({ data: 0, error: null });
  });
  it('returns 401 before any database lookup', async () => {
    authenticateApiRequest.mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
    const r = await getHandler(request);
    expect(r.status).toBe(401);
    expect(getUserAccess).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('returns 403 when the caller has no merchant access', async () => {
    getUserAccess.mockResolvedValue(null);
    const r = await getHandler(request);
    expect(r.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('returns 403 for staff without orders.fulfill', async () => {
    getUserAccess.mockResolvedValue(
      staff({ orders: { view: true, edit: true, fulfill: false } })
    );
    const r = await getHandler(request);
    expect(r.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('returns a numeric balance for an owner from the narrow RPC', async () => {
    rpc.mockResolvedValue({ data: '1250.50', error: null });
    const r = await getHandler(request);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      availableBalance: 1250.5,
      currency: 'NGN',
    });
    expect(rpc).toHaveBeenCalledWith('get_merchant_shipping_wallet_balance', {
      p_merchant_id: 'm1',
    });
    expect(rpc).not.toHaveBeenCalledWith(
      'get_wallet_summary',
      expect.anything()
    );
    expect(from).not.toHaveBeenCalled();
  });
  it('returns the balance for staff granted orders.fulfill', async () => {
    getUserAccess.mockResolvedValue(
      staff({ orders: { view: true, fulfill: true } })
    );
    rpc.mockResolvedValue({ data: 900, error: null });
    const r = await getHandler(request);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ availableBalance: 900, currency: 'NGN' });
    expect(rpc).toHaveBeenCalledWith('get_merchant_shipping_wallet_balance', {
      p_merchant_id: 'm1',
    });
  });
  it('passes bearer requests through the mobile-aware authenticator', async () => {
    const bearerRequest = new Request('http://localhost/api/merchant-wallet', {
      headers: { authorization: 'Bearer mobile-access-token' },
    }) as unknown as NextRequest;
    await getHandler(bearerRequest);
    expect(authenticateApiRequest).toHaveBeenCalledWith(bearerRequest);
  });
  it('uses zero when the merchant has no wallet row', async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    const response = await getHandler(request);
    expect(await response.json()).toEqual({
      availableBalance: 0,
      currency: 'NGN',
    });
  });
  it('redacts RPC failures', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('provider secret') });
    const r = await getHandler(request);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'Unable to load wallet' });
  });
});
