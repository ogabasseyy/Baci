import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const authenticate = vi.fn();
const access = vi.fn();
const permission = vi.fn();
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => authenticate(...args),
  getUserAccess: (...args: unknown[]) => access(...args),
  hasPermission: (...args: unknown[]) => permission(...args),
}));

import { GET } from './route';

describe('TikTok Ads status route', () => {
  it('does not disclose connection metadata without authentication', async () => {
    authenticate.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    expect(
      (
        await GET(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/tiktok/status'
          )
        )
      ).status
    ).toBe(401);
  });

  it('requires analytics or integration view permission for safe connection metadata', async () => {
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
            'https://usebaci.com/api/integrations/ads/tiktok/status'
          )
        )
      ).status
    ).toBe(403);
  });

  it('returns safe connected metadata to an authorized reader', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        account_timezone: 'Africa/Lagos',
        created_at: '2026-08-20T00:00:00Z',
        last_synced_at: null,
        provider: 'tiktok_ads',
        provider_account_label: 'Account',
        provider_customer_id: 'opaque-001',
        status: 'active',
        token_expires_at: null,
        updated_at: '2026-08-20T00:00:00Z',
      },
      error: null,
    });
    const query = {
      eq: vi.fn(),
      maybeSingle,
      select: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    authenticate.mockResolvedValue({
      error: null,
      supabase: { from: vi.fn(() => query) },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValueOnce(true);
    const response = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/tiktok/status')
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connected: true,
      connection: { providerAccountId: 'opaque-001' },
    });
  });
});
