import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOMER_ID,
  createRequest,
  MERCHANT_ID,
  mockOwnedCustomer,
  redeemMocks as mocks,
  POST,
  REWARD_ID,
} from './route.test-helpers';

describe('POST /api/storefront/loyalty/redeem idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOwnedCustomer();
  });

  it('returns 400 without an Idempotency-Key header', async () => {
    const response = await POST(
      createRequest(
        {
          merchant_id: MERCHANT_ID,
          customer_id: CUSTOMER_ID,
          reward_id: REWARD_ID,
        },
        null
      )
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error:
        'Missing or invalid Idempotency-Key header (UUID required for redemptions).',
    });
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-UUID Idempotency-Key header', async () => {
    const response = await POST(
      createRequest(
        {
          merchant_id: MERCHANT_ID,
          customer_id: CUSTOMER_ID,
          reward_id: REWARD_ID,
        },
        'not-a-uuid'
      )
    );
    expect(response.status).toBe(400);
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('maps idempotency_key_reused to 409', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: { success: false, error: 'idempotency_key_reused' },
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
      error:
        'Idempotency-Key already used for a different reward. Generate a fresh key for the new redemption.',
    });
  });

  it('maps idempotency_key_mismatch to 400', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: { success: false, error: 'idempotency_key_mismatch' },
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
      error: 'Idempotency-Key does not belong to this customer',
    });
  });
});
