import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOMER_ID,
  createRequest,
  createSuccessResult,
  MERCHANT_ID,
  mockOwnedCustomer,
  redeemMocks as mocks,
  POST,
  REWARD_ID,
} from './route.test-helpers';

describe('POST /api/storefront/loyalty/redeem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOwnedCustomer();
  });

  it('redeems via a single redeem_loyalty_reward RPC call', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: createSuccessResult(),
      error: null,
    });

    const response = await POST(
      createRequest({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        reward_id: REWARD_ID,
      })
    );
    const body = await response.json();

    expect(mocks.mockRpc).toHaveBeenCalledTimes(1);
    expect(mocks.mockRpc).toHaveBeenCalledWith('redeem_loyalty_reward', {
      p_merchant_id: MERCHANT_ID,
      p_customer_id: CUSTOMER_ID,
      p_reward_id: REWARD_ID,
    });
    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      message: 'Reward redeemed successfully',
      data: {
        redemption_code: 'RDM-ABCDEF123456',
        reward_name: 'Ten percent off',
        reward_type: 'discount',
        discount_value: 10,
        discount_type: 'percentage',
        points_spent: 100,
        new_balance: 1400,
        expires_at: '2026-11-09T00:00:00.000Z',
        instructions:
          'Apply this code at checkout to receive 10% off your order.',
      },
    });
  });

  it('returns 401 without a session', async () => {
    mocks.mockGetUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(
      createRequest({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        reward_id: REWARD_ID,
      })
    );

    expect(response.status).toBe(401);
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('returns 404 when the customer belongs to another user', async () => {
    mocks.mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await POST(
      createRequest({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        reward_id: REWARD_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Customer not found for this merchant' });
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 when ids are missing', async () => {
    const response = await POST(createRequest({ merchant_id: MERCHANT_ID }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'merchant_id, customer_id, and reward_id are required',
    });
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('returns 404 when the reward is unavailable', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: { success: false, error: 'reward_unavailable' },
      error: null,
    });

    const response = await POST(
      createRequest({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        reward_id: REWARD_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: 'Reward not found or no longer available',
    });
  });

  it('returns 404 when the customer is not enrolled', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: { success: false, error: 'not_enrolled' },
      error: null,
    });

    const response = await POST(
      createRequest({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        reward_id: REWARD_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: 'Customer is not enrolled in the loyalty program',
    });
  });

  it('returns 400 with required and available points when short', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: {
        success: false,
        error: 'insufficient_points',
        required: 200,
        available: 150,
      },
      error: null,
    });

    const response = await POST(
      createRequest({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        reward_id: REWARD_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'Insufficient points',
      required: 200,
      available: 150,
    });
  });

  it('returns 500 when the RPC call fails', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'connection reset' },
    });

    const response = await POST(
      createRequest({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        reward_id: REWARD_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to process redemption' });
  });

  it('returns 500 for a malformed success payload', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: { success: true, points_spent: 'many' },
      error: null,
    });

    const response = await POST(
      createRequest({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        reward_id: REWARD_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to process redemption' });
  });

  it('returns 403 without calling the RPC when CSRF validation fails', async () => {
    mocks.mockCheckCsrfProtection.mockResolvedValueOnce({
      valid: false,
      response: null,
    });

    const response = await POST(
      createRequest({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        reward_id: REWARD_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'CSRF validation failed' });
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('maps minimum_not_met to 400 with required/available/points_cost', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: {
        success: false,
        error: 'minimum_not_met',
        required: 500,
        available: 600,
        points_cost: 100,
      },
      error: null,
    });

    const response = await POST(
      createRequest({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        reward_id: REWARD_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'Minimum redemption amount not met',
      required: 500,
      available: 600,
      points_cost: 100,
    });
  });

  it('maps usage_limit_reached to 409', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: { success: false, error: 'usage_limit_reached' },
      error: null,
    });

    const response = await POST(
      createRequest({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        reward_id: REWARD_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: 'Redemption limit reached for this reward',
    });
  });
});
