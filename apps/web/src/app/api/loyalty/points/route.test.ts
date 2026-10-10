import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockSingle = vi.fn();
  const mockRpc = vi.fn();
  const mockUpdate = vi.fn();
  const mockInsert = vi.fn();
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    single: mockSingle,
    insert: mockInsert,
    update: mockUpdate,
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  mockInsert.mockReturnValue(chain);
  mockUpdate.mockReturnValue(chain);
  return {
    mockGetUser,
    mockSingle,
    mockRpc,
    mockUpdate,
    mockSupabase: {
      auth: { getUser: mockGetUser },
      from: vi.fn(() => chain),
      rpc: mockRpc,
    },
    mockCheckCsrfProtection: vi.fn(),
    mockGetMerchant: vi.fn(),
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({})),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mocks.mockSupabase),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) =>
    mocks.mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mocks.mockGetMerchant(...args),
}));

const { POST } = await import('./route');

const MERCHANT_ID = '01aa0000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '01aa0000-0000-4000-8000-000000000011';

function createRequest(body: unknown) {
  return new NextRequest('https://usebaci.com/api/loyalty/points', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/loyalty/points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mocks.mockCheckCsrfProtection.mockResolvedValue({
      valid: true,
      response: null,
    });
    mocks.mockGetMerchant.mockResolvedValue({ merchantId: MERCHANT_ID });
    mocks.mockRpc.mockResolvedValue({ data: 'Silver', error: null });
  });

  it('recomputes the tier when a manual award crosses a threshold', async () => {
    mocks.mockSingle.mockResolvedValue({
      data: {
        id: 'loyalty-1',
        points_balance: 900,
        lifetime_points: 900,
        current_tier: 'Bronze',
      },
      error: null,
    });

    const response = await POST(
      createRequest({ customerId: CUSTOMER_ID, points: 200 })
    );

    expect(response.status).toBe(200);
    expect(mocks.mockRpc).toHaveBeenCalledWith('calculate_loyalty_tier', {
      p_lifetime_points: 1100,
      p_merchant_id: MERCHANT_ID,
    });
    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        points_balance: 1100,
        lifetime_points: 1100,
        current_tier: 'Silver',
        tier_updated_at: expect.any(String),
      })
    );
  });

  it('leaves the tier alone when the award stays within it', async () => {
    mocks.mockSingle.mockResolvedValue({
      data: {
        id: 'loyalty-1',
        points_balance: 100,
        lifetime_points: 100,
        current_tier: 'Bronze',
      },
      error: null,
    });
    mocks.mockRpc.mockResolvedValue({ data: 'Bronze', error: null });

    const response = await POST(
      createRequest({ customerId: CUSTOMER_ID, points: 50 })
    );

    expect(response.status).toBe(200);
    const updateArg = mocks.mockUpdate.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(updateArg).not.toHaveProperty('current_tier');
    expect(updateArg).not.toHaveProperty('tier_updated_at');
  });

  it('still awards points when the tier lookup fails', async () => {
    mocks.mockSingle.mockResolvedValue({
      data: {
        id: 'loyalty-1',
        points_balance: 900,
        lifetime_points: 900,
        current_tier: 'Bronze',
      },
      error: null,
    });
    mocks.mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    });

    const response = await POST(
      createRequest({ customerId: CUSTOMER_ID, points: 200 })
    );

    expect(response.status).toBe(200);
    const updateArg = mocks.mockUpdate.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(updateArg.points_balance).toBe(1100);
    expect(updateArg).not.toHaveProperty('current_tier');
  });
});
