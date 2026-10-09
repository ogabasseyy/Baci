import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRpc, mockSupabase } = vi.hoisted(() => {
  const mockRpc = vi.fn();

  return {
    mockRpc,
    mockSupabase: {
      rpc: mockRpc,
    },
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({})),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { POST } from './route';

const MERCHANT_ID = '01aa0000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '01aa0000-0000-4000-8000-000000000011';

function createRequest(body: unknown) {
  return new NextRequest('https://usebaci.com/api/storefront/loyalty/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function createSuccessResult() {
  return {
    success: true,
    points_balance: 50,
    lifetime_points: 50,
    current_tier: 'Bronze',
    referral_code: 'ABCD1234',
    referral_bonus_applied: false,
  };
}

describe('POST /api/storefront/loyalty/enroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enrolls via a single enroll_customer_loyalty RPC call', async () => {
    mockRpc.mockResolvedValue({ data: createSuccessResult(), error: null });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('enroll_customer_loyalty', {
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
        tier: 'Bronze',
        referral_code: 'ABCD1234',
      },
    });
  });

  it('passes the referral code through to the RPC', async () => {
    mockRpc.mockResolvedValue({ data: createSuccessResult(), error: null });

    await POST(
      createRequest({
        merchant_id: MERCHANT_ID,
        customer_id: CUSTOMER_ID,
        referral_code: 'ref2024',
      })
    );

    expect(mockRpc).toHaveBeenCalledWith('enroll_customer_loyalty', {
      p_merchant_id: MERCHANT_ID,
      p_customer_id: CUSTOMER_ID,
      p_referral_code: 'ref2024',
    });
  });

  it('returns 400 when merchant_id or customer_id is missing', async () => {
    const response = await POST(createRequest({ merchant_id: MERCHANT_ID }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'merchant_id and customer_id are required',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 for non-UUID ids', async () => {
    const response = await POST(
      createRequest({ merchant_id: 'not-a-uuid', customer_id: CUSTOMER_ID })
    );

    expect(response.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid JSON body', async () => {
    const response = await POST(createRequest('{not json'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid JSON body' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 404 when the loyalty program is unavailable', async () => {
    mockRpc.mockResolvedValue({
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
    mockRpc.mockResolvedValue({
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
    mockRpc.mockResolvedValue({
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

  it('returns 500 when the RPC call fails', async () => {
    mockRpc.mockResolvedValue({
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
    mockRpc.mockResolvedValue({ data: null, error: null });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to enroll in loyalty program' });
  });
});
