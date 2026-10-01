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

describe('Meta Ads spend route', () => {
  it('validates an authenticated query before resolving merchant access', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: { from: vi.fn() },
      user: { id: 'user' },
    });
    access.mockClear();

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/spend?startDate=invalid'
      )
    );

    expect(response.status).toBe(400);
    expect(access).not.toHaveBeenCalled();
  });

  it('denies spend reads without analytics permission', async () => {
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
          new NextRequest('https://usebaci.com/api/integrations/ads/meta/spend')
        )
      ).status
    ).toBe(403);
  });

  it('scopes an omitted account id to the selected active account', async () => {
    const connection = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { provider_customer_id: 'act_123' },
        error: null,
      }),
      select: vi.fn().mockReturnThis(),
    };
    const spend = {
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
      select: vi.fn().mockReturnThis(),
    };
    const from = vi
      .fn()
      .mockReturnValueOnce(connection)
      .mockReturnValueOnce(spend);
    authenticate.mockResolvedValue({
      error: null,
      supabase: { from },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);

    const response = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/meta/spend')
    );

    expect(response.status).toBe(200);
    expect(connection.eq).toHaveBeenCalledWith('status', 'active');
    expect(spend.eq).toHaveBeenCalledWith('provider_customer_id', 'act_123');
  });

  it('rejects a direct spend window longer than the Meta sync limit', async () => {
    access.mockClear();
    authenticate.mockResolvedValue({
      error: null,
      supabase: { from: vi.fn() },
      user: { id: 'user' },
    });

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/meta/spend?accountId=act_123&startDate=2026-01-01&endDate=2026-02-01'
      )
    );

    expect(response.status).toBe(400);
    expect(access).not.toHaveBeenCalled();
  });
});
