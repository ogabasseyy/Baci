import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockRpc = vi.fn();
  return {
    mockGetUser,
    mockRpc,
    mockSupabase: {
      auth: { getUser: mockGetUser },
      from: vi.fn(),
      rpc: mockRpc,
    },
    mockCheckCsrfProtection: vi.fn(),
    mockGetMerchant: vi.fn(),
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({})),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mocks.mockSupabase),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) =>
    mocks.mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mocks.mockGetMerchant(...args),
}));

const { POST } = await import('./route');

const MERCHANT_ID = '01aa0000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '01aa0000-0000-4000-8000-000000000011';

function createRequest(body: unknown) {
  return new NextRequest('https://usebaci.com/api/loyalty/points', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/loyalty/points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mocks.mockCheckCsrfProtection.mockResolvedValue({
      valid: true,
      response: null,
    });
    mocks.mockGetMerchant.mockResolvedValue({
      merchantId: MERCHANT_ID,
      staffAccess: { isOwner: true, isStaff: false },
    });
    mocks.mockRpc.mockResolvedValue({
      data: {
        success: true,
        new_balance: 1100,
        lifetime_points: 1100,
        points_awarded: 200,
      },
      error: null,
    });
  });

  it('adjusts through the atomic RPC and returns balances', async () => {
    const response = await POST(
      createRequest({ customerId: CUSTOMER_ID, points: 200 })
    );

    expect(response.status).toBe(200);
    expect(mocks.mockRpc).toHaveBeenCalledWith('adjust_loyalty_points', {
      p_merchant_id: MERCHANT_ID,
      p_customer_id: CUSTOMER_ID,
      p_points: 200,
      p_reason: null,
      p_type: 'adjust',
    });
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      newBalance: 1100,
      lifetimePoints: 1100,
      pointsAwarded: 200,
    });
  });

  it('rejects staff adjustments with 403 before reaching the RPC', async () => {
    mocks.mockGetMerchant.mockResolvedValue({
      merchantId: MERCHANT_ID,
      staffAccess: { isOwner: false, isStaff: true },
    });

    const response = await POST(
      createRequest({ customerId: CUSTOMER_ID, points: 200 })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'Only the merchant owner can adjust loyalty points',
    });
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('passes the merchant reason through to the RPC', async () => {
    const response = await POST(
      createRequest({
        customerId: CUSTOMER_ID,
        points: -50,
        reason: 'Goodwill correction',
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.mockRpc).toHaveBeenCalledWith(
      'adjust_loyalty_points',
      expect.objectContaining({
        p_points: -50,
        p_reason: 'Goodwill correction',
      })
    );
  });

  it.each([
    ['customer_not_found', 404, 'Customer not found for this merchant'],
    ['merchant_not_found', 404, 'Merchant not found'],
    ['negative_balance', 400, 'Cannot reduce points below zero'],
    ['out_of_range', 400, 'Points adjustment is out of range'],
    ['creation_failed', 500, 'Failed to create loyalty record'],
    ['invalid_input', 400, 'Invalid manual award input'],
  ])('maps %s to %s', async (code, status, message) => {
    mocks.mockRpc.mockResolvedValue({
      data: { success: false, error: code },
      error: null,
    });

    const response = await POST(
      createRequest({ customerId: CUSTOMER_ID, points: 200 })
    );
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body).toEqual({ error: message });
  });

  it('fails closed on transport errors and malformed results', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    });
    const transport = await POST(
      createRequest({ customerId: CUSTOMER_ID, points: 200 })
    );
    expect(transport.status).toBe(500);

    mocks.mockRpc.mockResolvedValue({
      data: { success: true },
      error: null,
    });
    const malformed = await POST(
      createRequest({ customerId: CUSTOMER_ID, points: 200 })
    );
    expect(malformed.status).toBe(500);
  });

  it('rejects malformed input with 400 instead of 500ing', async () => {
    for (const body of [
      { customerId: 'not-a-uuid', points: 200 },
      { customerId: CUSTOMER_ID, points: 10.5 },
      { customerId: CUSTOMER_ID, points: 0 },
      { customerId: CUSTOMER_ID },
      { customerId: CUSTOMER_ID, points: 200, type: 'earn' },
    ]) {
      const response = await POST(createRequest(body));
      expect(response.status).toBe(400);
    }
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('rejects an invalid JSON body with 400', async () => {
    const response = await POST(
      new NextRequest('https://usebaci.com/api/loyalty/points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{bad json',
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: 'Invalid JSON body' });
  });
});
