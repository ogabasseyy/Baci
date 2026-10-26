import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  merchant: vi.fn(),
  gate: vi.fn(),
  csrf: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.merchant,
}));
vi.mock('@/lib/merchant-feature-gates', () => ({
  requireMerchantFeatureAccess: mocks.gate,
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateFeatures: mocks.revalidate,
  revalidateMerchant: mocks.revalidate,
}));

import { GET, PATCH } from './route';

function request(body: unknown) {
  return new NextRequest('https://usebaci.com/api/integrations/x-ads', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    user: { id: 'owner' },
    supabase: {
      rpc: mocks.rpc,
      from: (table: string) => {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            data:
              table === 'merchant_feature_settings'
                ? { twitter_pixel_id: 'pixel', twitter_event_ids: {} }
                : { merchant_id: 'merchant' },
            error: null,
          }),
        };
        return q;
      },
    },
  });
  mocks.merchant.mockResolvedValue({
    merchantId: 'merchant',
    staffAccess: { isOwner: true },
  });
  mocks.gate.mockResolvedValue(null);
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.rpc.mockResolvedValue({ error: null });
});
describe('X Ads setup API', () => {
  it('never returns the saved key', async () => {
    const r = await GET(
      new NextRequest('https://usebaci.com/api/integrations/x-ads')
    );
    expect(await r.json()).toEqual({
      pixelId: 'pixel',
      eventIds: {},
      capiConfigured: true,
    });
    expect(r.headers.get('cache-control')).toContain('no-store');
  });
  it('saves for the resolved owner and preserves a blank key', async () => {
    const r = await PATCH(request({ pixelId: 'pixel' }));
    expect(r.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('save_x_ads_settings', {
      p_merchant_id: 'merchant',
      p_pixel_id: 'pixel',
      p_credentials: undefined,
      p_event_ids: {},
      p_disconnect: false,
    });
  });
  it('writes a pixel token only to the owner RPC and never returns it', async () => {
    const response = await PATCH(
      request({
        pixelId: 'pixel',
        credentials: { pixelToken: 'synthetic-private-token' },
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'save_x_ads_settings',
      expect.objectContaining({
        p_merchant_id: 'merchant',
        p_credentials: { pixelToken: 'synthetic-private-token' },
      })
    );
    expect(await response.text()).not.toContain('synthetic-private-token');
  });
  it('rejects unauthenticated users', async () => {
    mocks.auth.mockResolvedValue({ error: 'Unauthorized' });
    expect((await PATCH(request({ pixelId: 'pixel' }))).status).toBe(401);
    expect(mocks.csrf).not.toHaveBeenCalled();
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects staff', async () => {
    mocks.merchant.mockResolvedValue({
      merchantId: 'merchant',
      staffAccess: { isOwner: false },
    });
    expect((await PATCH(request({ pixelId: 'pixel' }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects caller-selected tenant IDs before resolving merchant', async () => {
    expect(
      (await PATCH(request({ pixelId: 'pixel', merchantId: 'victim' }))).status
    ).toBe(400);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.gate).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON', async () => {
    const req = new NextRequest('https://usebaci.com/api/integrations/x-ads', {
      method: 'PATCH',
      body: '{',
    });
    expect((await PATCH(req)).status).toBe(400);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.gate).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('allows explicit disconnect without requiring an active paid plan', async () => {
    const r = await PATCH(request({ pixelId: null, disconnect: true }));
    expect(r.status).toBe(200);
    expect(mocks.gate).not.toHaveBeenCalled();
  });
  it('does not write after plan rejection', async () => {
    mocks.gate.mockResolvedValue(new Response('{}', { status: 402 }));
    expect((await PATCH(request({ pixelId: 'pixel' }))).status).toBe(402);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects CSRF failures before writing settings', async () => {
    mocks.csrf.mockResolvedValue({ valid: false });
    expect((await PATCH(request({ pixelId: 'pixel' }))).status).toBe(403);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.gate).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('returns a safe error when credential saving fails', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'private-key-echo' } });
    const response = await PATCH(request({ pixelId: 'pixel' }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(
      'private-key-echo'
    );
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('returns a safe error when connection status cannot be read', async () => {
    mocks.auth.mockResolvedValue({
      user: { id: 'owner' },
      supabase: {
        from: () => {
          const query = {
            select: () => query,
            eq: () => query,
            maybeSingle: async () => ({
              data: null,
              error: { message: 'private-database-detail' },
            }),
          };
          return query;
        },
      },
    });
    const response = await GET(
      new NextRequest('https://usebaci.com/api/integrations/x-ads')
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(
      'private-database-detail'
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
