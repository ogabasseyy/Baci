import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(() => Promise.resolve({ valid: true })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mockCreateServiceClient = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mockCreateServiceClient(),
}));

const mockRpc = vi.fn();
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: mockRpc }),
}));

const mockGetAuthenticatedUser = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/mobile-auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) =>
    mockGetAuthenticatedUser(...args),
}));

const mockBearerRpc = vi.fn();

// The sessionless gate is proven before finalization; the finalizer
// itself is unit-tested elsewhere.
const mockFinalizeOrderGatewayPayment = vi.hoisted(() => vi.fn());
vi.mock('@/lib/payments/finalize-order-gateway-payment', () => ({
  finalizeOrderGatewayPayment: (...args: unknown[]) =>
    mockFinalizeOrderGatewayPayment(...args),
}));

const mockProcessMerchantInvoicePartialPayment = vi.hoisted(() => vi.fn());
vi.mock('@/lib/payments/process-merchant-invoice-partial-payment', () => ({
  processMerchantInvoicePartialPayment: (...args: unknown[]) =>
    mockProcessMerchantInvoicePartialPayment(...args),
}));

import { POST } from './route';

const REFERENCE = 'BAC-VERIFY-9';
const TRACKING_TOKEN = 'track-token-9';
const ORDER_ID = 'order-9';

function snapshotRow() {
  return {
    transaction_id: 'txn-9',
    order_id: ORDER_ID,
    merchant_id: 'merchant-9',
    amount: '5000.00',
    currency: 'NGN',
    transaction_status: 'completed',
    gateway: 'paystack',
    gateway_reference: REFERENCE,
    order_number: 'ORD-9',
    order_payment_status: 'paid',
    order_shipping_status: 'pending',
    order_total: '5000.00',
    inventory_confirmed: true,
  };
}

function chain(result: { data: unknown; error: null }) {
  return {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    select: vi.fn().mockReturnThis(),
  };
}

// Locally-finalized paid order: the route answers from the stored rows
// without provider calls or finalization writes.
function serviceClientFor({
  transactionOrderId = ORDER_ID,
  orderCustomerId = 'cust-9',
  customerRow = { id: 'cust-9' },
}: {
  transactionOrderId?: string | null;
  orderCustomerId?: string | null;
  customerRow?: Record<string, string> | null;
} = {}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'transactions') {
        return chain({
          data: {
            amount: 5000,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: REFERENCE,
            gateway_response: { status: 'success' },
            id: 'txn-9',
            merchant_id: 'merchant-9',
            metadata: {},
            order_id: transactionOrderId,
            platform_fee: 0,
            status: 'completed',
          },
          error: null,
        });
      }
      if (table === 'orders') {
        return chain({
          data: {
            id: transactionOrderId,
            order_number: 'ORD-9',
            payment_status: 'paid',
            shipping_status: 'pending',
            total: 5000,
            customer_id: orderCustomerId,
          },
          error: null,
        });
      }
      if (table === 'customers') {
        return chain({ data: customerRow, error: null });
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

function postRequest(body: Record<string, string>, bearer?: string) {
  return new NextRequest('http://localhost:3000/api/payments/verify', {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    method: 'POST',
  });
}

describe('POST /api/payments/verify — sessionless authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateServiceClient.mockReturnValue(serviceClientFor());
    mockRpc.mockResolvedValue({ data: [snapshotRow()], error: null });
    mockGetAuthenticatedUser.mockResolvedValue(null);
    mockProcessMerchantInvoicePartialPayment.mockResolvedValue({
      kind: 'none',
    });
    mockFinalizeOrderGatewayPayment.mockResolvedValue({
      kind: 'completed',
      orderNumber: 'ORD-9',
    });
  });

  it('serves a Bearer [REDACTED] caller carrying the tracking-token proof', async () => {
    const response = await POST(
      postRequest(
        { reference: REFERENCE, trackingToken: TRACKING_TOKEN },
        'any-opaque-sessionless-caller-token'
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      status: 'success',
      orderId: ORDER_ID,
      orderTotal: 5000,
      currency: 'NGN',
      paymentMethod: 'paystack',
    });
    expect(mockRpc).toHaveBeenCalledWith(
      'get_guest_payment_reference_snapshot',
      {
        p_gateway_reference: REFERENCE,
        p_tracking_token: TRACKING_TOKEN,
      }
    );
    // The syntactic Bearer [REDACTED] alone authorizes nothing: no user-token
    // validation is even attempted on the proof path.
    expect(mockGetAuthenticatedUser).not.toHaveBeenCalled();
  });

  it('rejects a Bearer [REDACTED] caller whose tracking token mismatches', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const response = await POST(
      postRequest(
        { reference: REFERENCE, trackingToken: 'wrong-token' },
        'any-opaque-sessionless-caller-token'
      )
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toStrictEqual({ error: 'Verification unavailable' });
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
  });

  it('serves a validated user token bound to the order customer', async () => {
    mockBearerRpc.mockResolvedValue({ data: ORDER_ID, error: null });
    mockGetAuthenticatedUser.mockResolvedValue({
      authMode: 'bearer',
      user: { id: 'user-9' },
      supabase: { rpc: mockBearerRpc },
    });
    const response = await POST(
      postRequest({ reference: REFERENCE }, 'valid-user-session-token')
    );
    const body = await response.json();

    expect(mockGetAuthenticatedUser).toHaveBeenCalled();
    expect(mockBearerRpc).toHaveBeenCalledWith(
      'authorize_sessionless_verify_reference',
      { p_gateway_reference: REFERENCE }
    );
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, orderId: ORDER_ID });
  });

  it('rejects an unvalidatable Bearer [REDACTED] without a tracking token', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);

    const response = await POST(
      postRequest({ reference: REFERENCE }, 'arbitrary-forged-string')
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toStrictEqual({ error: 'Verification unavailable' });
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
  });

  it('rejects a validated user whose customer does not own the order', async () => {
    mockBearerRpc.mockResolvedValue({ data: null, error: null });
    mockGetAuthenticatedUser.mockResolvedValue({
      authMode: 'bearer',
      user: { id: 'user-intruder' },
      supabase: { rpc: mockBearerRpc },
    });

    const response = await POST(
      postRequest({ reference: REFERENCE }, 'valid-but-unrelated-session')
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toStrictEqual({ error: 'Verification unavailable' });
  });

  it('refuses when the reference resolves to a different order than proven', async () => {
    mockCreateServiceClient.mockReturnValue(
      serviceClientFor({ transactionOrderId: 'order-other' })
    );

    const response = await POST(
      postRequest(
        { reference: REFERENCE, trackingToken: TRACKING_TOKEN },
        'any-opaque-sessionless-caller-token'
      )
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toStrictEqual({ error: 'Verification unavailable' });
  });

  it('keeps session (cookie-CSRF) authority without a tracking token', async () => {
    const response = await POST(postRequest({ reference: REFERENCE }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, orderId: ORDER_ID });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockGetAuthenticatedUser).not.toHaveBeenCalled();
  });
});
