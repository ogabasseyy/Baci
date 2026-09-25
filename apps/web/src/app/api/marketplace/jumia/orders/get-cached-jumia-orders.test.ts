import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

import { getCachedJumiaOrders } from './get-cached-jumia-orders';

describe('getCachedJumiaOrders', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 before merchant or order queries when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await getCachedJumiaOrders({
      url: 'https://example.test/api/marketplace/jumia/orders',
    } as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });
});
