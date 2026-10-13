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

describe('TikTok Ads spend route', () => {
  it('does not disclose decimal spend or provider conversions without authentication', async () => {
    authenticate.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    expect(
      (
        await GET(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/tiktok/spend'
          )
        )
      ).status
    ).toBe(401);
  });

  it('validates an authenticated query before resolving merchant access', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: { from: vi.fn() },
      user: { id: 'user' },
    });
    access.mockClear();

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/tiktok/spend?endDate=invalid'
      )
    );

    expect(response.status).toBe(400);
    expect(access).not.toHaveBeenCalled();
  });

  it('requires analytics view permission before querying provider-labelled spend', async () => {
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
            'https://usebaci.com/api/integrations/ads/tiktok/spend'
          )
        )
      ).status
    ).toBe(403);
  });

  it('returns exact decimal provider-labelled spend to an authorized analytics reader', async () => {
    const query = {
      eq: vi.fn(),
      gte: vi.fn(),
      lte: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
      select: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.gte.mockReturnValue(query);
    query.lte.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.range.mockResolvedValue({
      data: [
        {
          account_timezone: 'Africa/Lagos',
          attribution_metadata: { provider: 'tiktok_ads' },
          clicks: '2',
          conversions: '1',
          currency_code: 'NGN',
          fetched_at: '2026-08-20T00:00:00Z',
          impressions: '10',
          provider_customer_id: 'opaque-001',
          reach: '8',
          spend_amount_decimal: '1.000000001',
          spend_date: '2026-08-20',
        },
      ],
      error: null,
    });
    authenticate.mockResolvedValue({
      error: null,
      supabase: { from: vi.fn(() => query) },
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/tiktok/spend?accountId=opaque-001'
      )
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      currencyCode: 'NGN',
      rows: [expect.objectContaining({ spendAmountDecimal: '1.000000001' })],
    });
  });

  it('scopes an omitted account id to the selected active account', async () => {
    const connection = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { provider_customer_id: 'opaque-selected' },
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
      new NextRequest('https://usebaci.com/api/integrations/ads/tiktok/spend')
    );

    expect(response.status).toBe(200);
    expect(connection.eq).toHaveBeenCalledWith('status', 'active');
    expect(spend.eq).toHaveBeenCalledWith(
      'provider_customer_id',
      'opaque-selected'
    );
  });

  it('rejects a direct spend window longer than the TikTok sync limit', async () => {
    access.mockClear();
    authenticate.mockResolvedValue({
      error: null,
      supabase: { from: vi.fn() },
      user: { id: 'user' },
    });

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/tiktok/spend?accountId=opaque-001&startDate=2026-08-01&endDate=2026-08-31'
      )
    );

    expect(response.status).toBe(400);
    expect(access).not.toHaveBeenCalled();
  });
});
