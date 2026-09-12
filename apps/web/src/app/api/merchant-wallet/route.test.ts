import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const rpc = vi.fn();
const from = vi.fn();
const authenticateApiRequest = vi.fn();
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser }, from, rpc })),
}));
const { GET } = await import('./route');
const getHandler = GET as (request: NextRequest) => Promise<Response>;
const request = new Request(
  'http://localhost/api/merchant-wallet'
) as unknown as NextRequest;
function merchantQuery(data: unknown, error: Error | null = null) {
  return {
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data, error }) }),
    }),
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
  });
  it('returns 401 before any database lookup', async () => {
    authenticateApiRequest.mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
    const r = await getHandler(request);
    expect(r.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('returns 403 for a non-owner', async () => {
    from.mockReturnValue(merchantQuery(null));
    const r = await getHandler(request);
    expect(r.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('redacts owner lookup errors', async () => {
    from.mockReturnValue(merchantQuery(null, new Error('secret db')));
    const r = await getHandler(request);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'Unable to load merchant' });
  });
  it('returns a numeric balance for an owner', async () => {
    from.mockReturnValue(merchantQuery({ id: 'm1' }));
    rpc.mockResolvedValue({
      data: [{ available_balance: '1250.50' }],
      error: null,
    });
    const r = await getHandler(request);
    expect(await r.json()).toEqual({
      availableBalance: 1250.5,
      currency: 'NGN',
    });
    expect(rpc).toHaveBeenCalledWith('get_wallet_summary', {
      p_merchant_id: 'm1',
    });
  });
  it('passes bearer requests through the mobile-aware authenticator', async () => {
    from.mockReturnValue(merchantQuery({ id: 'm1' }));
    rpc.mockResolvedValue({ data: [], error: null });
    const bearerRequest = new Request('http://localhost/api/merchant-wallet', {
      headers: { authorization: 'Bearer mobile-access-token' },
    }) as unknown as NextRequest;
    await getHandler(bearerRequest);
    expect(authenticateApiRequest).toHaveBeenCalledWith(bearerRequest);
  });
  it('uses zero when the wallet row is missing', async () => {
    from.mockReturnValue(merchantQuery({ id: 'm1' }));
    rpc.mockResolvedValue({ data: [], error: null });
    const response = await getHandler(request);
    const result = await response.json();
    expect(result).toEqual({
      availableBalance: 0,
      currency: 'NGN',
    });
  });
  it('redacts RPC failures', async () => {
    from.mockReturnValue(merchantQuery({ id: 'm1' }));
    rpc.mockResolvedValue({ data: null, error: new Error('provider secret') });
    const r = await getHandler(request);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'Unable to load wallet' });
  });
});
