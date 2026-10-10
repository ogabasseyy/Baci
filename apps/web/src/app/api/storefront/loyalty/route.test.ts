import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOMER_ID,
  createRequest,
  createStatusResult,
  GET,
  MERCHANT_ID,
  mockOwnedCustomer,
  loyaltyMocks as mocks,
} from './route.test-helpers';

describe('GET /api/storefront/loyalty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOwnedCustomer();
  });

  it('returns the mapped loyalty status', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: createStatusResult(),
      error: null,
    });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );
    const body = await response.json();

    expect(mocks.mockRpc).toHaveBeenCalledWith('get_loyalty_status', {
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
      tier_progress: 50,
      referral_code: 'ABCD1234',
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
    mocks.mockRpc.mockResolvedValue({
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

  it('returns 401 without a session', async () => {
    mocks.mockGetUser.mockResolvedValue({ data: { user: null } });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );

    expect(response.status).toBe(401);
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid query params', async () => {
    const response = await GET(
      createRequest(`merchant_id=not-a-uuid&customer_id=${CUSTOMER_ID}`)
    );

    expect(response.status).toBe(400);
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('returns 404 when the customer belongs to another user', async () => {
    mocks.mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );

    expect(response.status).toBe(404);
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('returns 404 when the program is unavailable', async () => {
    mocks.mockRpc.mockResolvedValue({
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
    mocks.mockRpc.mockResolvedValue({
      data: { success: true, enrolled: true },
      error: null,
    });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );

    expect(response.status).toBe(500);
  });
});
