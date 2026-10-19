import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOMER_ID,
  createRequest,
  createSuccessResult,
  MERCHANT_ID,
  mockSession,
  enrollMocks as mocks,
  POST,
} from './route.test-helpers';

describe('POST /api/storefront/loyalty/enroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  it('enrolls via a single enroll_customer_loyalty RPC call', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: createSuccessResult(),
      error: null,
    });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(mocks.mockRpc).toHaveBeenCalledTimes(1);
    expect(mocks.mockRpc).toHaveBeenCalledWith('enroll_customer_loyalty', {
      p_merchant_id: MERCHANT_ID,
      p_customer_id: CUSTOMER_ID,
      p_referral_code: null,
    });
    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      message: 'Successfully enrolled in loyalty program',
      data: {
        points_balance: 50,
        tier: 'bronze',
        referral_code: 'ABCD1234',
      },
    });
  });

  it('passes the referral code through to the RPC', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: createSuccessResult(),
      error: null,
    });

    await POST(
      createRequest({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        referral_code: 'ref2024',
      })
    );

    expect(mocks.mockRpc).toHaveBeenCalledWith('enroll_customer_loyalty', {
      p_merchant_id: MERCHANT_ID,
      p_customer_id: CUSTOMER_ID,
      p_referral_code: 'ref2024',
    });
  });

  it('returns 401 without a session', async () => {
    mocks.mockGetUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Authentication required' });
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('consults the RPC instead of short-circuiting ownership mismatches', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: { success: false, error: 'customer_not_found' },
      error: null,
    });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(mocks.mockRpc).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Customer not found for this merchant' });
  });

  it('returns 400 when merchant_id or customer_id is missing', async () => {
    const response = await POST(createRequest({ merchant_id: MERCHANT_ID }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'merchant_id and customer_id are required',
    });
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 for non-UUID ids', async () => {
    const response = await POST(
      createRequest({ merchant_id: 'not-a-uuid', customer_id: CUSTOMER_ID })
    );

    expect(response.status).toBe(400);
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 with a generic message for invalid referral codes', async () => {
    const response = await POST(
      createRequest({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        referral_code: '',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid enrollment input' });
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid JSON body', async () => {
    const response = await POST(createRequest('{not json'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid JSON body' });
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('returns 404 when the loyalty program is unavailable', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: { success: false, error: 'program_unavailable' },
      error: null,
    });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: 'Loyalty program not available for this merchant',
    });
  });

  it('returns 404 when the customer does not belong to the merchant', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: { success: false, error: 'customer_not_found' },
      error: null,
    });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Customer not found for this merchant' });
  });
});
