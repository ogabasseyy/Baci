import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.fn();
const access = vi.fn();
const permission = vi.fn();
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => auth(...args),
  getUserAccess: (...args: unknown[]) => access(...args),
  hasPermission: (...args: unknown[]) => permission(...args),
}));
vi.mock('@/lib/ads/snapchat/config', () => ({
  getSnapchatAdsConfig: () => ({
    clientId: 'client',
    oauthStateSecret: 'x'.repeat(32),
    redirectUri: 'https://usebaci.com/api/integrations/ads/snapchat/callback',
  }),
  SnapchatAdsConfigError: class SnapchatAdsConfigError extends Error {},
}));

import { GET } from './route';

describe('Snapchat Ads connect route', () => {
  it('denies unauthenticated OAuth starts', async () => {
    auth.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    expect(
      (
        await GET(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/snapchat/connect'
          )
        )
      ).status
    ).toBe(401);
  });

  it('reserves a server nonce before redirecting to Snap', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    auth.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/snapchat/connect'
      )
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('snapchat.com');
    expect(rpc).toHaveBeenCalledWith(
      'reserve_snapchat_ads_oauth_state_nonce',
      expect.objectContaining({ p_merchant_id: 'merchant', p_user_id: 'user' })
    );
  });

  it('returns a readable authorization URL for same-origin dashboard fetches', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    auth.mockResolvedValue({
      error: null,
      supabase: { rpc },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/snapchat/connect',
        { headers: { accept: 'application/json' } }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    const payload = (await response.json()) as { authorizationUrl?: string };
    expect(payload.authorizationUrl).toContain('snapchat.com');
    expect(response.headers.get('set-cookie')).toContain(
      'baci_snapchat_ads_oauth_state='
    );
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(
      setCookie.match(/baci_snapchat_ads_oauth_state=/g) ?? []
    ).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
