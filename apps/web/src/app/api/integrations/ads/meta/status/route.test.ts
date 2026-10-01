import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticate = vi.fn();
const access = vi.fn();
const permission = vi.fn();
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => authenticate(...args),
  getUserAccess: (...args: unknown[]) => access(...args),
  hasPermission: (...args: unknown[]) => permission(...args),
}));

import { GET } from './route';

describe('Meta Ads status route', () => {
  const maybeSingle = vi.fn();
  const eqProvider = vi.fn(() => ({ maybeSingle }));
  const eqMerchant = vi.fn(() => ({ eq: eqProvider }));
  const select = vi.fn(() => ({ eq: eqMerchant }));

  beforeEach(() => {
    vi.clearAllMocks();
    authenticate.mockResolvedValue({
      error: null,
      supabase: { from: vi.fn(() => ({ select })) },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
  });

  it('denies users without analytics or integrations visibility', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: {},
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(false);
    expect(
      (
        await GET(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/meta/status'
          )
        )
      ).status
    ).toBe(403);
  });

  it('reports expired and revoked/error connections as disconnected', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: {
        account_timezone: 'Africa/Lagos',
        created_at: '2026-08-01T00:00:00Z',
        last_synced_at: null,
        provider: 'meta_ads',
        provider_account_label: 'Account',
        provider_customer_id: 'act_1',
        status: 'active',
        token_expires_at: new Date(Date.now() - 1).toISOString(),
        updated_at: '2026-08-01T00:00:00Z',
      },
      error: null,
    });
    const expired = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/meta/status')
    );
    expect(await expired.json()).toMatchObject({
      connected: false,
      connection: { status: 'reauth_required' },
    });

    maybeSingle.mockResolvedValueOnce({
      data: {
        account_timezone: null,
        created_at: '2026-08-01T00:00:00Z',
        last_synced_at: null,
        provider: 'meta_ads',
        provider_account_label: null,
        provider_customer_id: 'act_1',
        status: 'error',
        token_expires_at: null,
        updated_at: '2026-08-01T00:00:00Z',
      },
      error: null,
    });
    const revoked = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/meta/status')
    );
    expect(await revoked.json()).toMatchObject({
      connected: false,
      connection: { status: 'error' },
    });
  });
});
