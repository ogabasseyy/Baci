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

describe('POST /api/storefront/loyalty/enroll replay and failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  it('returns success when the customer is already enrolled', async () => {
    // Lost-response retry: the original enrollment committed, so the
    // retry converges on success with the persisted enrollment fields
    // for the caller's receipt.
    mocks.mockRpc.mockImplementation(async (fn: string) =>
      fn === 'get_loyalty_status'
        ? {
            data: {
              points_balance: 120,
              current_tier: 'Silver',
              referral_code: 'REF12345',
            },
            error: null,
          }
        : { data: { success: false, error: 'already_enrolled' }, error: null }
    );

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      message: 'Already enrolled in loyalty program',
      data: {
        already_enrolled: true,
        points_balance: 120,
        tier: 'silver',
        referral_code: 'REF12345',
      },
    });
  });

  it('fails retryably when the replay status envelope reports failure', async () => {
    // get_loyalty_status answers failures as success:false envelopes,
    // not PostgREST errors: defaults must not become a receipt.
    mocks.mockRpc.mockImplementation(async (fn: string) =>
      fn === 'get_loyalty_status'
        ? {
            data: { success: false, error: 'customer_not_found' },
            error: null,
          }
        : { data: { success: false, error: 'already_enrolled' }, error: null }
    );

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );

    expect(response.status).toBe(500);
  });

  it('fails retryably when the replay status lookup errors', async () => {
    // Fabricating zero/bronze defaults would misreport a committed
    // enrollment; a failed status read must surface as a failure.
    mocks.mockRpc.mockImplementation(async (fn: string) =>
      fn === 'get_loyalty_status'
        ? { data: null, error: { message: 'db unavailable' } }
        : { data: { success: false, error: 'already_enrolled' }, error: null }
    );

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );

    expect(response.status).toBe(500);
  });

  it('returns 400 when the configured bonus is out of range', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: { success: false, error: 'out_of_range' },
      error: null,
    });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Enrollment bonus is out of range' });
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
