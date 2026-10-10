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
export const redeemMocks = mocks;

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
export const { POST } = await import('./route');

export const MERCHANT_ID = '01aa0000-0000-4000-8000-000000000001';
export const CUSTOMER_ID = '01aa0000-0000-4000-8000-000000000011';
export const USER_ID = '01aa0000-0000-4000-8000-000000000101';
export const REWARD_ID = '02aa0000-0000-4000-8000-000000000001';

export function createRequest(body: unknown) {
  return new NextRequest('https://usebaci.com/api/storefront/loyalty/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export function createSuccessResult() {
  return {
    success: true,
    redemption_code: 'RDM-ABCDEF123456',
    reward_name: 'Ten percent off',
    reward_type: 'discount_percentage',
    reward_value: 10,
    points_spent: 100,
    new_balance: 1400,
    expires_at: '2026-11-09T00:00:00.000Z',
  };
}

export function mockOwnedCustomer() {
  mocks.mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mocks.mockMaybeSingle.mockResolvedValue({
    data: { id: CUSTOMER_ID },
    error: null,
  });
}
