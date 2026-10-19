import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkCsrfProtection: vi.fn(),
  createClient: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
  hasPermission: vi.fn(),
  toUserAccess: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({})),
}));
vi.mock('@/lib/api-auth', () => ({
  hasPermission: mocks.hasPermission,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.getMerchantForApiRequest,
  toUserAccess: mocks.toUserAccess,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

import { GET, POST } from './route';

function createQuery(result: { data: unknown; error: unknown }) {
  const query = {
    eq: vi.fn(() => query),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query mocks are intentionally thenable.
    get then() {
      return (resolve: (value: unknown) => unknown) =>
        Promise.resolve(result).then(resolve);
    },
    limit: vi.fn(() => query),
    order: vi.fn(() => query),
    or: vi.fn(() => query),
    range: vi.fn(() => query),
    select: vi.fn(() => query),
  };
  return query;
}

describe('GET /api/customers/segments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
    });
    mocks.hasPermission.mockReturnValue(true);
    mocks.toUserAccess.mockReturnValue({ permissions: {} });
  });

  it('reads the segment summary view using its actual avg_clv column', async () => {
    const summaryQuery = createQuery({
      data: [
        {
          avg_clv: 125,
          customer_count: 2,
          merchant_id: 'merchant-1',
          segment_name: 'Champions',
          total_revenue: 800,
        },
      ],
      error: null,
    });
    const customersQuery = createQuery({ data: [], error: null });
    const definitionsQuery = createQuery({ data: [], error: null });
    const from = vi.fn((table: string) => {
      if (table === 'customer_segment_summary') return summaryQuery;
      if (table === 'customer_rfm_scores') return customersQuery;
      return definitionsQuery;
    });
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from,
    });

    const requestedMerchantId = '123e4567-e89b-42d3-a456-426614174000';
    const response = await GET(
      new NextRequest('https://usebaci.com/api/customers/segments?limit=100', {
        headers: { 'x-baci-merchant-id': requestedMerchantId },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      summary: [
        expect.objectContaining({
          avg_clv: 125,
          customer_count: 2,
          segment_name: 'Champions',
        }),
      ],
    });
    expect(summaryQuery.select).toHaveBeenCalledWith(
      'merchant_id, segment_name, customer_count, total_revenue, avg_clv'
    );
    expect(mocks.getMerchantForApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      { requestedMerchantId }
    );
  });

  it('returns an error when the segment summary cannot be read', async () => {
    const summaryQuery = createQuery({
      data: null,
      error: { message: 'summary unavailable' },
    });
    const from = vi.fn((table: string) => {
      if (table === 'customer_segment_summary') return summaryQuery;
      return createQuery({ data: [], error: null });
    });
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from,
    });

    const response = await GET(
      new NextRequest('https://usebaci.com/api/customers/segments')
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to fetch segment summary',
    });
  });

  it('rejects invalid pagination before reading segment rows', async () => {
    const from = vi.fn();
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from,
    });

    const response = await GET(
      new NextRequest('https://usebaci.com/api/customers/segments?limit=101')
    );

    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('authenticates refresh mutations before checking CSRF', async () => {
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const response = await POST(
      new NextRequest('https://usebaci.com/api/customers/segments', {
        method: 'POST',
      })
    );

    expect(response.status).toBe(401);
    expect(mocks.checkCsrfProtection).not.toHaveBeenCalled();
  });
});
