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

import { GET } from './route';

describe('Snapchat Ads status route', () => {
  it('does not disclose connection metadata to unauthenticated users', async () => {
    auth.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    expect(
      (
        await GET(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/snapchat/status'
          )
        )
      ).status
    ).toBe(401);
  });

  it('returns safe active connection metadata without ciphertext', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        access_token_ciphertext: 'SNAP_STATUS_CIPHERTEXT_SENTINEL',
        account_timezone: 'UTC',
        created_at: 'created',
        last_synced_at: null,
        provider: 'snapchat_ads',
        provider_account_label: 'Account',
        provider_customer_id: 'ad',
        status: 'active',
        token_expires_at: 'expiry',
        updated_at: 'updated',
      },
      error: null,
    });
    const query = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle,
      select: vi.fn().mockReturnThis(),
    };
    auth.mockResolvedValue({
      error: null,
      supabase: { from: vi.fn().mockReturnValue(query) },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/snapchat/status'
      )
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.connection).not.toHaveProperty('access_token_ciphertext');
    expect(JSON.stringify(body)).not.toContain(
      'SNAP_STATUS_CIPHERTEXT_SENTINEL'
    );
  });

  it('denies callers without analytics or integrations view permission', async () => {
    auth.mockResolvedValue({ error: null, supabase: {}, user: { id: 'user' } });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(false);
    expect(
      (
        await GET(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/snapchat/status'
          )
        )
      ).status
    ).toBe(403);
  });

  it('returns merchant-not-found and database failures without connection data', async () => {
    auth.mockResolvedValue({ error: null, supabase: {}, user: { id: 'user' } });
    access.mockResolvedValue(null);
    permission.mockReturnValue(true);
    expect(
      (
        await GET(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/snapchat/status'
          )
        )
      ).status
    ).toBe(404);

    const maybeSingle = vi.fn().mockResolvedValue({
      data: { access_token_ciphertext: 'SNAP_STATUS_DB_SENTINEL' },
      error: { message: 'SNAP_STATUS_DB_SENTINEL' },
    });
    const query = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle,
      select: vi.fn().mockReturnThis(),
    };
    auth.mockResolvedValue({
      error: null,
      supabase: { from: vi.fn().mockReturnValue(query) },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/snapchat/status'
      )
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(
      'SNAP_STATUS_DB_SENTINEL'
    );
  });
});
