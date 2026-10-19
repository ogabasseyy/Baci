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

describe('Snapchat Ads spend route', () => {
  it('does not expose reporting rows without authentication', async () => {
    auth.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    expect(
      (
        await GET(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/snapchat/spend'
          )
        )
      ).status
    ).toBe(401);
  });

  it('validates an authenticated query before tenant or connection reads', async () => {
    const from = vi.fn();
    auth.mockResolvedValue({
      error: null,
      supabase: { from },
      user: { id: 'user' },
    });
    access.mockClear();

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/snapchat/spend?startDate=invalid'
      )
    );

    expect(response.status).toBe(400);
    expect(access).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('returns normalized safe spend metrics for an authenticated viewer', async () => {
    const connection = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { account_timezone: 'UTC', provider_customer_id: 'ad' },
        error: null,
      }),
      select: vi.fn().mockReturnThis(),
    };
    const spend = {
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: [
          {
            access_token_ciphertext: 'SNAP_SPEND_SENTINEL',
            account_timezone: 'UTC',
            attribution_metadata: { provider: 'snapchat_ads' },
            clicks: '2',
            conversions: '1',
            currency_code: 'USD',
            fetched_at: 'now',
            impressions: '5',
            provider_customer_id: 'ad',
            spend_amount_decimal: '1.2',
            spend_date: '2026-08-20',
            spend_micros: '1200000',
          },
        ],
        error: null,
      }),
      select: vi.fn().mockReturnThis(),
    };
    auth.mockResolvedValue({
      error: null,
      supabase: {
        from: vi
          .fn()
          .mockReturnValueOnce(connection)
          .mockReturnValueOnce(spend),
      },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/snapchat/spend?startDate=2026-08-20&endDate=2026-08-20'
      )
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.rows[0]).toMatchObject({
      clicksLabel: 'Swipe Ups',
      spendMicros: '1200000',
    });
    expect(connection.eq).toHaveBeenCalledWith('status', 'active');
    expect(spend.eq).toHaveBeenCalledWith('provider_customer_id', 'ad');
    expect(JSON.stringify(body)).not.toContain('SNAP_SPEND_SENTINEL');
  });

  it('denies viewers without analytics permission before reading connections', async () => {
    const from = vi.fn();
    auth.mockResolvedValue({
      error: null,
      supabase: { from },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(false);
    const response = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/snapchat/spend')
    );
    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns safe validation and query failures without provider sentinels', async () => {
    const validConnection = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { account_timezone: 'UTC', provider_customer_id: 'ad' },
        error: null,
      }),
      select: vi.fn().mockReturnThis(),
    };
    const failedConnection = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { access_token_ciphertext: 'SNAP_CONNECTION_SENTINEL' },
        error: { message: 'SNAP_CONNECTION_SENTINEL' },
      }),
      select: vi.fn().mockReturnThis(),
    };
    const failedSpend = {
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: [{ provider_body: 'SNAP_SPEND_QUERY_SENTINEL' }],
        error: { message: 'SNAP_SPEND_QUERY_SENTINEL' },
      }),
      select: vi.fn().mockReturnThis(),
    };
    const from = vi
      .fn()
      .mockReturnValueOnce(validConnection)
      .mockReturnValueOnce(failedSpend)
      .mockReturnValueOnce(failedConnection);
    auth.mockResolvedValue({
      error: null,
      supabase: { from },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);

    const invalid = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/snapchat/spend?startDate=nope'
      )
    );
    expect(invalid.status).toBe(400);
    const spendFailure = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/snapchat/spend')
    );
    expect(spendFailure.status).toBe(500);
    expect(JSON.stringify(await spendFailure.json())).not.toContain(
      'SNAP_SPEND_QUERY_SENTINEL'
    );
    const connectionFailure = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/snapchat/spend')
    );
    expect(connectionFailure.status).toBe(500);
    expect(JSON.stringify(await connectionFailure.json())).not.toContain(
      'SNAP_CONNECTION_SENTINEL'
    );
  });

  it('rejects a direct spend window longer than the Snapchat sync limit', async () => {
    access.mockClear();
    auth.mockResolvedValue({
      error: null,
      supabase: { from: vi.fn() },
      user: { id: 'user' },
    });

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/snapchat/spend?accountId=acc-01_x&startDate=2025-01-01&endDate=2026-01-02'
      )
    );

    expect(response.status).toBe(400);
    expect(access).not.toHaveBeenCalled();
  });
});
