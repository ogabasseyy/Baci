import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticate = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockQuery = {
  eq: vi.fn(),
  from: vi.fn(),
  gte: vi.fn(),
  lte: vi.fn(),
  maybeSingle: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  select: vi.fn(),
};
for (const method of [
  mockQuery.from,
  mockQuery.select,
  mockQuery.eq,
  mockQuery.gte,
  mockQuery.lte,
]) {
  method.mockReturnValue(mockQuery);
}

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => mockAuthenticate(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

import { GET } from './route';

describe('GET /api/integrations/ads/google/spend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({
      error: null,
      supabase: mockQuery,
      user: { id: 'user-1' },
    });
    mockGetUserAccess.mockResolvedValue({ merchantId: 'merchant-1' });
    mockHasPermission.mockReturnValue(true);
    mockQuery.order.mockReturnValue(mockQuery);
    mockQuery.range.mockResolvedValue({
      data: [
        {
          clicks: 2,
          conversions: 1,
          currency_code: 'NGN',
          fetched_at: '2026-08-21T00:00:00.000Z',
          impressions: 10,
          provider_customer_id: '1234567890',
          spend_date: '2026-08-20',
          spend_micros: 1250000,
        },
      ],
      error: null,
    });
    mockQuery.maybeSingle.mockResolvedValue({
      data: { provider_customer_id: '1234567890' },
      error: null,
    });
  });

  it('returns 401 for an unauthenticated request', async () => {
    mockAuthenticate.mockResolvedValueOnce({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    const response = await GET(
      new NextRequest('https://usebaci.com/api/integrations/ads/google/spend')
    );
    expect(response.status).toBe(401);
  });

  it('returns 400 for an invalid customer id', async () => {
    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/spend?customerId=bad'
      )
    );
    expect(response.status).toBe(400);
    expect(mockGetUserAccess).not.toHaveBeenCalled();
    expect(mockQuery.from).not.toHaveBeenCalled();
    expect(mockQuery.order).not.toHaveBeenCalled();
  });

  it('returns tenant-scoped normalized spend', async () => {
    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/spend?customerId=1234567890&startDate=2026-08-20&endDate=2026-08-20'
      )
    );
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.totalSpendMicros).toBe('1250000');
    expect(json.rows[0].spend).toBe(1.25);
  });

  it('filters an omitted customer id to the currently selected account', async () => {
    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/spend?startDate=2026-08-20&endDate=2026-08-20'
      )
    );

    expect(response.status).toBe(200);
    expect(mockQuery.maybeSingle).toHaveBeenCalledTimes(1);
    expect(mockQuery.eq).toHaveBeenCalledWith(
      'provider_customer_id',
      '1234567890'
    );
  });

  it('rejects a direct spend window longer than the Google sync limit', async () => {
    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/integrations/ads/google/spend?startDate=2026-01-01&endDate=2026-04-01'
      )
    );

    expect(response.status).toBe(400);
    expect(mockGetUserAccess).not.toHaveBeenCalled();
    expect(mockQuery.from).not.toHaveBeenCalled();
  });
});
