import { NextRequest } from 'next/server';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const mockRpc = vi.fn();
  const mockGetUser = vi.fn();
  const mockMaybeSingle = vi.fn();
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle: mockMaybeSingle,
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);

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
});

// Hoisted bindings cannot be exported; alias for test assertions.
export const loyaltyMocks = mocks;

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({})),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mocks.mockSupabase),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

// Import the handler AFTER mocks so the route binds the mocked modules.
export const { GET } = await import('./route');

export const MERCHANT_ID = '01aa0000-0000-4000-8000-000000000001';
export const CUSTOMER_ID = '01aa0000-0000-4000-8000-000000000011';
export const USER_ID = '01aa0000-0000-4000-8000-000000000101';

export function createRequest(query: string) {
  return new NextRequest(
    `https://usebaci.com/api/storefront/loyalty?${query}`,
    { method: 'GET' }
  );
}

export function createStatusResult() {
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
    referral_code: 'ABCD1234',
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

export function mockOwnedCustomer() {
  mocks.mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mocks.mockMaybeSingle.mockResolvedValue({
    data: { id: CUSTOMER_ID },
    error: null,
  });
}
