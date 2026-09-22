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

// Proof-bound snapshot row as returned by the
// get_guest_payment_reference_snapshot RPC (snake_case columns).
function snapshotRow(overrides = {}) {
  return {
    transaction_id: 'txn-9',
    order_id: 'order-9',
    merchant_id: 'merchant-9',
    amount: '5000.00',
    currency: 'NGN',
    transaction_status: 'pending',
    gateway: 'paystack',
    gateway_reference: REFERENCE,
    gateway_response: null,
    metadata: {},
    platform_fee: '0.00',
    order_number: 'ORD-9',
    order_payment_status: 'pending',
    order_shipping_status: 'pending',
    order_total: '5000.00',
    ...overrides,
  };
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

  it('serves a guest verification without touching the service-role client', async () => {
    mockRpc.mockResolvedValue({ data: [snapshotRow()], error: null });

    const response = await POST(
      guestRequest({ reference: REFERENCE, trackingToken: TRACKING_TOKEN })
    );
    const body = await response.json();

    // Proceeds past auth into verification: terminal failed envelope
    // with the proof-bound order identity (not a 403 collapsed to
    // transient). All reads come from the snapshot RPC — the generic
    // service-role client is never constructed for a sessionless request.
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: false,
      status: 'failed',
      orderId: 'order-9',
    });
    expect(mockVerifyPaystack).toHaveBeenCalledWith(REFERENCE);
    expect(mockRpc).toHaveBeenCalledWith(
      'get_guest_payment_reference_snapshot',
      {
        p_gateway_reference: REFERENCE,
        p_tracking_token: TRACKING_TOKEN,
      }
    );
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
  });

  it('reports a gateway-confirmed guest payment as pending without finalizing', async () => {
    mockRpc.mockResolvedValue({ data: [snapshotRow()], error: null });
    // Provider confirms the full amount (kobo): finalization belongs to
    // the webhook boundary, so the guest sees pending and settlement
    // polling converges on the next pass.
    mockVerifyPaystack.mockResolvedValue({
      success: true,
      data: { status: 'success', amount: 500000, currency: 'NGN' },
    });

    const response = await POST(
      guestRequest({ reference: REFERENCE, trackingToken: TRACKING_TOKEN })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: false,
      status: 'pending',
      orderId: 'order-9',
      orderNumber: 'ORD-9',
    });
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
  });

  it('converges a locally-finalized guest payment without finalizing', async () => {
    mockRpc.mockResolvedValue({
      data: [
        snapshotRow({
          transaction_status: 'completed',
          order_payment_status: 'paid',
        }),
      ],
      error: null,
    });

    const response = await POST(
      guestRequest({ reference: REFERENCE, trackingToken: TRACKING_TOKEN })
    );
    const body = await response.json();

    // The paid order row is itself the completed finalization: the
    // guest converges without a provider call and without any
    // service-role read or write.
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      status: 'success',
      orderId: 'order-9',
      orderNumber: 'ORD-9',
      orderTotal: 5000,
      currency: 'NGN',
      finalizationOutcome: 'completed',
    });
    expect(mockVerifyPaystack).not.toHaveBeenCalled();
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
  });

  it('rejects a mismatched tracking token without verifying', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const response = await POST(
      guestRequest({ reference: REFERENCE, trackingToken: 'wrong-token' })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Invalid CSRF token');
    expect(mockVerifyPaystack).not.toHaveBeenCalled();
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
  });

  it('rejects a guest verification with no token at all', async () => {
    const response = await POST(guestRequest({ reference: REFERENCE }));

    expect(response.status).toBe(403);
    expect(mockCreateAnonClient).not.toHaveBeenCalled();
    expect(mockVerifyPaystack).not.toHaveBeenCalled();
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
  });

  it('fails closed when the snapshot RPC errors', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('db down') });

    const response = await POST(
      guestRequest({ reference: REFERENCE, trackingToken: TRACKING_TOKEN })
    );

    expect(response.status).toBe(403);
    expect(mockVerifyPaystack).not.toHaveBeenCalled();
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
  });

  it('fails closed on a malformed snapshot row', async () => {
    mockRpc.mockResolvedValue({
      data: [{ transaction_id: 'txn-9' }],
      error: null,
    });

    const response = await POST(
      guestRequest({ reference: REFERENCE, trackingToken: TRACKING_TOKEN })
    );

    expect(response.status).toBe(403);
    expect(mockVerifyPaystack).not.toHaveBeenCalled();
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
  });
});
