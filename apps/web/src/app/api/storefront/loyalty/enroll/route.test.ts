import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOMER_ID,
  createRequest,
  createSuccessResult,
  MERCHANT_ID,
  mockOwnedCustomer,
  enrollMocks as mocks,
  POST,
} from './route.test-helpers';

describe('POST /api/storefront/loyalty/enroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOwnedCustomer();
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

  it('returns 404 when the customer belongs to another user', async () => {
    mocks.mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Customer not found for this merchant' });
    expect(mocks.mockRpc).not.toHaveBeenCalled();
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

  it('returns 409 when the customer is already enrolled', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: { success: false, error: 'already_enrolled' },
      error: null,
    });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: 'Customer is already enrolled in the loyalty program',
    });
  });

  it('returns 503 when referral codes collide', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: { success: false, error: 'referral_code_collision' },
      error: null,
    });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: 'Enrollment is temporarily unavailable, please try again',
    });
  });

  it('returns 500 when the RPC call fails', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'connection reset' },
    });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to enroll in loyalty program' });
  });

  it('returns 500 for an unexpected RPC result', async () => {
    mocks.mockRpc.mockResolvedValue({ data: null, error: null });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to enroll in loyalty program' });
  });

  it('returns 500 for a malformed success payload', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: { success: true, points_balance: 'fifty' },
      error: null,
    });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to enroll in loyalty program' });
  });

  it('returns 403 without calling the RPC when CSRF validation fails', async () => {
    mocks.mockCheckCsrfProtection.mockResolvedValueOnce({
      valid: false,
      response: null,
    });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'CSRF validation failed' });
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });
});
