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

describe('POST /api/storefront/loyalty/redeem instructions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOwnedCustomer();
  });

  it('renders fixed-discount instructions in the merchant currency', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: {
        ...createSuccessResult(),
        reward_name: 'Two thousand off',
        reward_type: 'discount_fixed',
        reward_value: 2000,
      },
      error: null,
    });
    mocks.mockMaybeSingle
      .mockResolvedValueOnce({
        data: { id: CUSTOMER_ID },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { country: 'US', payout_currency: 'USD' },
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

    expect(response.status).toBe(200);
    expect(body.data.instructions).toBe(
      'Apply this code at checkout to receive $2,000 off your order.'
    );
  });

  it('falls back to NGN instructions when the merchant row is unreadable', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: {
        ...createSuccessResult(),
        reward_name: 'Two thousand off',
        reward_type: 'discount_fixed',
        reward_value: 2000,
      },
      error: null,
    });
    mocks.mockMaybeSingle
      .mockResolvedValueOnce({
        data: { id: CUSTOMER_ID },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST500' } });

    const response = await POST(
      createRequest({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        reward_id: REWARD_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.instructions).toBe(
      'Apply this code at checkout to receive ₦2,000 off your order.'
    );
  });

  it('renders a generic label for a plain discount without a value', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: {
        ...createSuccessResult(),
        reward_name: 'Mystery discount',
        reward_type: 'discount',
        reward_value: null,
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

    expect(response.status).toBe(200);
    expect(body.data.instructions).toBe(
      'Apply this code at checkout to receive your discount.'
    );
  });
});
