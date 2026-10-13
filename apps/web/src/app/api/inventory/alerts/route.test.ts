import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkCsrfProtection: vi.fn(),
  createClient: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
  hasPermission: vi.fn(),
  toUserAccess: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock('@/lib/api-auth', () => ({ hasPermission: mocks.hasPermission }));
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

import { GET, PATCH } from './route';

function queryResult(result: {
  count?: number | null;
  data: unknown;
  error: unknown;
}) {
  const query = {
    eq: vi.fn(() => query),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query mocks are intentionally thenable.
    get then() {
      return (resolve: (value: unknown) => unknown) =>
        Promise.resolve(result).then(resolve);
    },
    order: vi.fn(() => query),
    select: vi.fn(() => query),
  };
  return query;
}

describe('inventory alerts dashboard API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
    });
    mocks.hasPermission.mockReturnValue(true);
    mocks.toUserAccess.mockReturnValue({ permissions: {} });
  });

  it('reads explicit alert fields for the selected merchant', async () => {
    const alerts = queryResult({ data: [], error: null });
    const counts = queryResult({ data: [], error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(alerts)
      .mockReturnValueOnce(counts);
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
      new Request('https://usebaci.com/api/inventory/alerts?status=active', {
        headers: { 'x-baci-merchant-id': requestedMerchantId },
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mocks.getMerchantForApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      { requestedMerchantId }
    );
    expect(alerts.select).toHaveBeenCalledWith(
      expect.stringContaining('alert_type'),
      { count: 'exact' }
    );
    expect(alerts.select).not.toHaveBeenCalledWith('*');
  });

  it('returns the exact count when the alert rows are capped', async () => {
    const alerts = queryResult({
      count: 1_501,
      data: [{ id: 'latest-alert' }],
      error: null,
    });
    const counts = queryResult({ data: [], error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(alerts)
      .mockReturnValueOnce(counts);
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
        }),
      },
      from,
    });

    const response = await GET(
      new Request(
        'https://usebaci.com/api/inventory/alerts?status=resolved'
      ) as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      alerts: [{ id: 'latest-alert' }],
      stats: { total: 1_501 },
    });
  });

  it('rejects invalid filters before reading inventory rows', async () => {
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
      new Request(
        'https://usebaci.com/api/inventory/alerts?status=deleted'
      ) as never
    );

    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('authenticates mutations before checking CSRF', async () => {
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const response = await PATCH(
      new Request('https://usebaci.com/api/inventory/alerts', {
        method: 'PATCH',
      }) as never
    );

    expect(response.status).toBe(401);
    expect(mocks.checkCsrfProtection).not.toHaveBeenCalled();
  });
});
