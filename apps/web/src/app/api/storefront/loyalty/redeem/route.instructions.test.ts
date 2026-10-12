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

  it('stays currency-neutral when the merchant lookup fails', async () => {
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
      'Apply this code at checkout to receive a fixed-amount discount off your order.'
    );
    expect(body.data.instructions).not.toContain('₦');
  });

  it('falls back to NGN only when the merchant row is cleanly absent', async () => {
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
      .mockResolvedValueOnce({ data: null, error: null });

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

  it('directs a valueless plain discount to manual fulfillment, not checkout', async () => {
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
    expect(body.data.instructions).toContain('Present this code');
    expect(body.data.instructions).not.toContain('checkout');
  });

  it('directs free-shipping redemptions to manual fulfillment, not checkout', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: {
        ...createSuccessResult(),
        reward_name: 'Free delivery',
        reward_type: 'free_shipping',
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
    expect(body.data.instructions).toContain('Present this code');
    expect(body.data.instructions).not.toContain('checkout');
  });
});
