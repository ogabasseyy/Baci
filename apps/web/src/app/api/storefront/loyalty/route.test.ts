import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRpc, mockGetUser, mockMaybeSingle, mockSupabase } = vi.hoisted(
  () => {
    const mockRpc = vi.fn();
    const mockGetUser = vi.fn();
    const mockMaybeSingle = vi.fn();
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: mockMaybeSingle,
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);

    return {
      mockRpc,
      mockGetUser,
      mockMaybeSingle,
      mockSupabase: {
        auth: { getUser: mockGetUser },
        from: vi.fn(() => chain),
        rpc: mockRpc,
      },
    };
  }
);

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({})),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { GET } from './route';

const MERCHANT_ID = '01aa0000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '01aa0000-0000-4000-8000-000000000011';
const USER_ID = '01aa0000-0000-4000-8000-000000000101';

function createRequest(query: string) {
  return new NextRequest(
    `https://usebaci.com/api/storefront/loyalty?${query}`,
    { method: 'GET' }
  );
}

function createStatusResult() {
  return {
    success: true,
    enrolled: true,
    points_balance: 150,
    lifetime_points: 500,
    current_tier: 'Bronze',
    tiers: [
      { name: 'Bronze', minPoints: 0 },
      { name: 'Silver', minPoints: 1000 },
      { name: 'Gold', minPoints: 5000 },
      { name: 'Platinum', minPoints: 10000 },
    ],
    signup_bonus_points: 50,
    referral_bonus_points: 100,
    points_per_currency: 1,
    points_currency_unit: 100,
    rewards: [
      {
        id: 'reward-1',
        name: 'Free shipping',
        description: null,
        points_cost: 200,
        reward_type: 'free_shipping',
        reward_value: null,
      },
    ],
    transactions: [
      {
        id: 'txn-1',
        points: 50,
        type: 'bonus',
        description: 'Loyalty signup bonus',
        created_at: '2026-10-09T00:00:00.000Z',
      },
    ],
  };
}

describe('GET /api/storefront/loyalty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mockMaybeSingle.mockResolvedValue({
      data: { id: CUSTOMER_ID },
      error: null,
    });
  });

  it('returns the mapped loyalty status', async () => {
    mockRpc.mockResolvedValue({ data: createStatusResult(), error: null });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );
    const body = await response.json();

    expect(mockRpc).toHaveBeenCalledWith('get_loyalty_status', {
      p_merchant_id: MERCHANT_ID,
      p_customer_id: CUSTOMER_ID,
    });
    expect(response.status).toBe(200);
    expect(body).toEqual({
      enrolled: true,
      points_balance: 150,
      lifetime_points: 500,
      tier: 'bronze',
      next_tier: 'silver',
      points_to_next_tier: 500,
      tier_thresholds: {
        bronze: 0,
        silver: 1000,
        gold: 5000,
        platinum: 10000,
      },
      available_rewards: [
        {
          id: 'reward-1',
          name: 'Free shipping',
          description: '',
          points_required: 200,
          reward_type: 'free_shipping',
          discount_value: undefined,
          active: true,
        },
      ],
      redeemable_rewards: [],
      recent_transactions: [
        {
          id: 'txn-1',
          points: 50,
          type: 'bonus',
          description: 'Loyalty signup bonus',
          created_at: '2026-10-09T00:00:00.000Z',
        },
      ],
      settings: {
        points_per_naira: 0.01,
        naira_per_point: 100,
        welcome_bonus: 50,
        referral_bonus_referrer: 100,
        referral_bonus_referee: 100,
      },
    });
  });

  it('returns zeros for a non-enrolled customer', async () => {
    mockRpc.mockResolvedValue({
      data: {
        ...createStatusResult(),
        enrolled: false,
        points_balance: 0,
        lifetime_points: 0,
        transactions: [],
      },
      error: null,
    });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enrolled).toBe(false);
    expect(body.points_balance).toBe(0);
    expect(body.next_tier).toBe('silver');
    expect(body.points_to_next_tier).toBe(1000);
  });

  it('passes custom tier names through lowercased', async () => {
    mockRpc.mockResolvedValue({
      data: { ...createStatusResult(), current_tier: 'Diamond' },
      error: null,
    });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tier).toBe('diamond');
  });

  it('returns 401 without a session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );

    expect(response.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid query params', async () => {
    const response = await GET(
      createRequest(`merchant_id=not-a-uuid&customer_id=${CUSTOMER_ID}`)
    );

    expect(response.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 404 when the customer belongs to another user', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );

    expect(response.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 404 when the program is unavailable', async () => {
    mockRpc.mockResolvedValue({
      data: { success: false, error: 'program_unavailable' },
      error: null,
    });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: 'Loyalty program not available for this merchant',
    });
  });

  it('returns 500 for a malformed status payload', async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, enrolled: true },
      error: null,
    });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );

    expect(response.status).toBe(500);
  });
});
