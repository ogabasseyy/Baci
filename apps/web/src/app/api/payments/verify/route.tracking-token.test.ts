import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheckCsrf = vi.fn();
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrf(...args),
}));

const mockVerifyPaystack = vi.fn();
vi.mock('@/lib/paystack', () => ({
  verifyTransaction: (...args: unknown[]) => mockVerifyPaystack(...args),
}));

vi.mock('@/lib/korapay', () => ({
  verifyPayment: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mockCreateServiceClient = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mockCreateServiceClient(),
}));

const mockRpc = vi.fn();
const mockCreateAnonClient = vi.fn(() => ({ rpc: mockRpc }));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => mockCreateAnonClient(),
}));

import { POST } from './route';

const REFERENCE = 'BAC-VERIFY-9';
const TRACKING_TOKEN = 'track-token-9';

// Downstream verification still runs on the service client (pre-existing
// edge); only the guest proof binding moved to the anon RPC.
function buildSupabase() {
  const from = vi.fn((table: string) => {
    if (table === 'transactions') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'txn-9',
            order_id: 'order-9',
            merchant_id: 'merchant-9',
            amount: 5000,
            currency: 'NGN',
            status: 'pending',
            gateway: 'paystack',
            gateway_reference: REFERENCE,
            gateway_response: null,
            metadata: {},
            platform_fee: 0,
          },
          error: null,
        }),
      };
    }
    if (table === 'orders') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'order-9',
            order_number: 'ORD-9',
            payment_status: 'pending',
            shipping_status: 'pending',
            total: 5000,
          },
          error: null,
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  return { from };
}

function guestRequest(body: unknown) {
  // No session, no CSRF pair: the guest native caller.
  return new NextRequest('http://localhost:3000/api/payments/verify', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

describe('/api/payments/verify tracking-token authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCsrf.mockResolvedValue({ valid: false });
    mockVerifyPaystack.mockResolvedValue({
      success: true,
      data: { status: 'failed' },
    });
  });

  it('authorizes a guest verification whose token matches the reference order', async () => {
    mockCreateServiceClient.mockReturnValue(buildSupabase());
    mockRpc.mockResolvedValue({ data: true, error: null });

    const response = await POST(
      guestRequest({ reference: REFERENCE, trackingToken: TRACKING_TOKEN })
    );
    const body = await response.json();

    // Proceeds past auth into verification: terminal failed envelope
    // with the trusted order identity (not a 403 collapsed to transient).
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: false,
      status: 'failed',
      orderId: 'order-9',
    });
    expect(mockVerifyPaystack).toHaveBeenCalledWith(REFERENCE);
  });

  it('rejects a mismatched tracking token without verifying', async () => {
    mockCreateServiceClient.mockReturnValue(buildSupabase());
    mockRpc.mockResolvedValue({ data: false, error: null });

    const response = await POST(
      guestRequest({ reference: REFERENCE, trackingToken: 'wrong-token' })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Invalid CSRF token');
    expect(mockVerifyPaystack).not.toHaveBeenCalled();
  });

  it('rejects a guest verification with no token at all', async () => {
    const response = await POST(guestRequest({ reference: REFERENCE }));

    expect(response.status).toBe(403);
    expect(mockCreateAnonClient).not.toHaveBeenCalled();
    expect(mockVerifyPaystack).not.toHaveBeenCalled();
  });

  it('rejects when the order carries no tracking token', async () => {
    mockCreateServiceClient.mockReturnValue(buildSupabase());
    mockRpc.mockResolvedValue({ data: false, error: null });

    const response = await POST(
      guestRequest({ reference: REFERENCE, trackingToken: TRACKING_TOKEN })
    );

    expect(response.status).toBe(403);
    expect(mockVerifyPaystack).not.toHaveBeenCalled();
  });

  it('fails closed when the proof RPC errors', async () => {
    mockCreateServiceClient.mockReturnValue(buildSupabase());
    mockRpc.mockResolvedValue({ data: null, error: new Error('db down') });

    const response = await POST(
      guestRequest({ reference: REFERENCE, trackingToken: TRACKING_TOKEN })
    );

    expect(response.status).toBe(403);
    expect(mockVerifyPaystack).not.toHaveBeenCalled();
  });
});
