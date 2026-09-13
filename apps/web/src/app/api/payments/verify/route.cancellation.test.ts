import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: (callback: () => void | Promise<void>) => {
      void Promise.resolve(callback()).catch(() => {
        // Ignore background task errors in tests.
      });
    },
  };
});

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(() => Promise.resolve({ valid: true })),
}));

const mockVerifyPaystack = vi.fn();
vi.mock('@/lib/paystack', () => ({
  verifyTransaction: (...args: unknown[]) => mockVerifyPaystack(...args),
}));

vi.mock('@/lib/korapay', () => ({
  verifyPayment: vi.fn(),
}));

const mockNotifyNewOrder = vi.fn();
const mockNotifyPaymentReceived = vi.fn();
vi.mock('@/lib/expo-push', () => ({
  notifyNewOrder: (...args: unknown[]) => mockNotifyNewOrder(...args),
  notifyPaymentReceived: (...args: unknown[]) =>
    mockNotifyPaymentReceived(...args),
}));

// The verify route now runs the same claim-gated outbox as the webhook via
// finalizeOrderGatewayPayment; the outbox itself is unit-tested elsewhere.
const mockRunPaidOrderSideEffects = vi.fn().mockResolvedValue({
  concurrentTakeoverSteps: [],
  failedSteps: [],
  ranSteps: [],
  skippedSteps: [],
});
vi.mock('@/lib/payments/run-paid-order-side-effects', () => ({
  runPaidOrderSideEffects: (...args: unknown[]) =>
    mockRunPaidOrderSideEffects(...args),
}));

const mockProcessMerchantInvoicePartialPayment = vi.hoisted(() => vi.fn());
vi.mock('@/lib/payments/process-merchant-invoice-partial-payment', () => ({
  processMerchantInvoicePartialPayment: (...args: unknown[]) =>
    mockProcessMerchantInvoicePartialPayment(...args),
}));

const mockCaptureOrHoldRedvaultPayment = vi.hoisted(() => vi.fn());
vi.mock('@/lib/payments/redvault-capture-hold', () => ({
  captureOrHoldRedvaultPayment: (...args: unknown[]) =>
    mockCaptureOrHoldRedvaultPayment(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mockCreateServiceClient = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mockCreateServiceClient(),
}));

// handlePaymentForCancelledOrder files the reconciliation row through a
// service-role admin client (reconciliation_review is RLS-locked to
// service_role), not the route's own service client.
const mockReconciliationInsert = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: null, error: null })
);
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'reconciliation_review') {
        return { insert: mockReconciliationInsert };
      }
      throw new Error(`Unexpected admin table: ${table}`);
    }),
  })),
}));

import { POST } from './route';

const REFERENCE = 'BAC-VERIFY-1';

function createRequest() {
  return new NextRequest('http://localhost:3000/api/payments/verify', {
    body: JSON.stringify({ reference: REFERENCE }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

const richOrderRow = {
  ad_tracking: null,
  cancelled_at: null,
  currency: 'NGN',
  customer_email: 'jane@example.com',
  customer_id: 'cust-1',
  customer_name: 'Jane',
  customer_phone: '+234',
  discount_amount: 0,
  gift_wrapping_fee: 0,
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_items: [],
  order_number: 'ORD-1',
  payment_status: 'paid',
  shipping_address: {},
  shipping_fee: 0,
  shipping_status: 'processing',
  subtotal: 1000,
  tax_amount: 0,
  tax_basis: null,
  total: 1000,
  updated_at: '2026-07-13T00:00:00Z',
};

function buildSupabase({
  transactionStatus = 'pending',
  existingOrderStatus = 'unpaid',
  gateway = 'paystack',
  gatewayResponse = { fees: 123, status: 'success' } as Record<
    string,
    unknown
  > | null,
  metadata = {} as Record<string, unknown>,
  completion,
  inventoryConfirmationError = null,
}: {
  transactionStatus?: string;
  existingOrderStatus?: string;
  gateway?: string;
  gatewayResponse?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  completion: Record<string, unknown> | null;
  inventoryConfirmationError?: unknown;
}) {
  const normalizedCompletion =
    completion && !('error_code' in completion)
      ? {
          actor: 'verify:BAC-VERIFY-1',
          already_completed: false,
          cancelled_at: null,
          order_already_paid: false,
          order_cancelled: false,
          order_number: 'ORD-1',
          order_skipped_status: null,
          order_updated: false,
          payment_status: existingOrderStatus,
          previous_payment_status: existingOrderStatus,
          previous_shipping_status: 'pending',
          shipping_status: 'processing',
          ...completion,
        }
      : completion;
  const rpc = vi.fn((name: string) => {
    const data =
      name === 'complete_order_gateway_payment'
        ? normalizedCompletion
        : name === 'claim_payment_side_effect'
          ? { current_status: 'claimed', we_won: true }
          : null;
    const result = {
      data,
      error:
        name === 'confirm_order_inventory_reservations'
          ? inventoryConfirmationError
          : null,
    };
    return Object.assign(Promise.resolve(result), {
      single: () => Promise.resolve(result),
    });
  });

  const from = vi.fn((table: string) => {
    if (table === 'transactions') {
      return {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            amount: 1000,
            currency: 'NGN',
            gateway,
            gateway_reference: REFERENCE,
            gateway_response: gatewayResponse,
            id: 'txn-1',
            merchant_id: 'merchant-1',
            metadata,
            order_id: 'order-1',
            platform_fee: 0,
            status: transactionStatus,
          },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      };
    }
    if (table === 'orders') {
      // existingOrder lookup uses .maybeSingle(); the finalizer's rich
      // order fetch uses .single().
      return {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'order-1',
            order_number: 'ORD-1',
            payment_status: existingOrderStatus,
            shipping_status: 'pending',
          },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: richOrderRow, error: null }),
      };
    }
    if (table === 'payment_side_effects') {
      return {
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              error: 'side_effect_failed',
              status: 'failed',
              transaction_id: 'txn-1',
            },
          ],
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });

  return { from, rpc };
}

describe('POST /api/payments/verify — finalizer outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunPaidOrderSideEffects.mockResolvedValue({
      concurrentTakeoverSteps: [],
      failedSteps: [],
      ranSteps: [],
      skippedSteps: [],
    });
    mockVerifyPaystack.mockResolvedValue({
      data: { amount: 100_000, currency: 'NGN', status: 'success' },
      success: true,
    });
    mockProcessMerchantInvoicePartialPayment.mockResolvedValue({
      kind: 'none',
    });
    mockCaptureOrHoldRedvaultPayment.mockResolvedValue({
      kind: 'not_redvault',
    });
  });

  it('returns a pending response instead of a paid signal for a held REDVAULT capture', async () => {
    const supabase = buildSupabase({ completion: null });
    mockCreateServiceClient.mockReturnValue(supabase);
    mockCaptureOrHoldRedvaultPayment.mockResolvedValue({
      duplicate: false,
      kind: 'captured_held',
      reason: 'provider_eligibility_evidence_unavailable',
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      code: 'REDVAULT_CAPTURE_HELD',
      error: 'Payment capture is pending eligibility confirmation',
      orderNumber: 'ORD-1',
      status: 'pending',
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.anything()
    );
    expect(mockRunPaidOrderSideEffects).not.toHaveBeenCalled();
  });

  it('suppresses paid-order side effects and files reconciliation when the order is cancelled', async () => {
    const supabase = buildSupabase({
      completion: {
        already_completed: false,
        cancelled_at: '2026-06-15T00:00:00Z',
        order_already_paid: false,
        order_cancelled: true,
        order_number: 'ORD-1',
        order_updated: false,
        shipping_status: 'cancelled',
      },
    });
    mockCreateServiceClient.mockReturnValue(supabase);

    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ status: 'success', success: true });
    expect(mockNotifyNewOrder).not.toHaveBeenCalled();
    expect(mockRunPaidOrderSideEffects).not.toHaveBeenCalled();
    expect(mockReconciliationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'payment_received_after_cancellation',
        order_id: 'order-1',
      })
    );
  });

  it('returns success without paid-order side effects for an applied strict partial', async () => {
    const supabase = buildSupabase({
      completion: {
        already_completed: true,
        merchant_invoice_partial_recorded: true,
        order_already_paid: false,
        order_cancelled: false,
        order_number: 'ORD-1',
        order_updated: false,
        payment_status: 'partially_paid',
        previous_payment_status: 'partially_paid',
        shipping_status: 'pending',
        transaction_status: 'completed',
      },
      existingOrderStatus: 'partially_paid',
      transactionStatus: 'completed',
    });
    mockCreateServiceClient.mockReturnValue(supabase);

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      orderNumber: 'ORD-1',
      status: 'success',
      success: true,
    });
    expect(mockRunPaidOrderSideEffects).not.toHaveBeenCalled();
    expect(mockReconciliationInsert).not.toHaveBeenCalled();
  });

  it('applies a verified pending merchant-invoice underpayment before standard finalization', async () => {
    const supabase = buildSupabase({
      completion: null,
      metadata: { order_payment_allocation: 'merchant_invoice_partial' },
    });
    mockCreateServiceClient.mockReturnValue(supabase);
    mockProcessMerchantInvoicePartialPayment.mockResolvedValue({
      body: {
        amountPaid: 600,
        balanceDue: 400,
        message: 'Merchant invoice partial payment recorded',
        orderNumber: 'ORD-1',
        success: true,
      },
      kind: 'processed',
      status: 200,
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      balanceDue: 400,
      success: true,
    });
    expect(mockProcessMerchantInvoicePartialPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway: 'paystack',
        transaction: expect.objectContaining({
          metadata: { order_payment_allocation: 'merchant_invoice_partial' },
        }),
      })
    );
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.anything()
    );
  });

  it('fires push and the outbox side effects when the order is NOT cancelled', async () => {
    const supabase = buildSupabase({
      completion: {
        already_completed: false,
        cancelled_at: null,
        order_already_paid: false,
        order_cancelled: false,
        order_number: 'ORD-1',
        order_updated: true,
        payment_status: 'paid',
        previous_payment_status: 'unpaid',
        previous_shipping_status: 'pending',
        shipping_status: 'processing',
      },
    });
    mockCreateServiceClient.mockReturnValue(supabase);

    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ orderNumber: 'ORD-1', success: true });
    expect(mockReconciliationInsert).not.toHaveBeenCalled();
    expect(mockNotifyNewOrder).toHaveBeenCalled();
    expect(mockRunPaidOrderSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: `verify:${REFERENCE}`,
        settlementGateway: 'paystack',
      })
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.objectContaining({
        p_order_id: 'order-1',
        p_transaction_id: 'txn-1',
      })
    );
  });

  it('heals a wedged order (completed transaction, unpaid order) instead of short-circuiting', async () => {
    const supabase = buildSupabase({
      completion: {
        already_completed: true,
        cancelled_at: null,
        order_already_paid: false,
        order_cancelled: false,
        order_number: 'ORD-1',
        order_updated: true,
        payment_status: 'paid',
        previous_payment_status: 'unpaid',
        previous_shipping_status: 'pending',
        shipping_status: 'processing',
      },
      existingOrderStatus: 'unpaid',
      transactionStatus: 'completed',
    });
    mockCreateServiceClient.mockReturnValue(supabase);

    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ status: 'success', success: true });
    // The re-verify heal path re-verifies with the gateway before touching
    // anything, then runs the full finalizer (push + outbox).
    expect(mockVerifyPaystack).toHaveBeenCalledWith(REFERENCE);
    expect(mockNotifyNewOrder).toHaveBeenCalled();
    expect(mockRunPaidOrderSideEffects).toHaveBeenCalled();
  });

  it('drains the outbox for a completed transaction whose order is already paid', async () => {
    const supabase = buildSupabase({
      completion: {
        already_completed: true,
        cancelled_at: null,
        order_already_paid: true,
        order_cancelled: false,
        order_number: 'ORD-1',
        order_updated: false,
        payment_status: 'paid',
        previous_payment_status: 'paid',
        previous_shipping_status: 'processing',
        shipping_status: 'processing',
      },
      existingOrderStatus: 'paid',
      transactionStatus: 'completed',
    });
    mockCreateServiceClient.mockReturnValue(supabase);
    mockVerifyPaystack.mockRejectedValue(
      new Error('gateway verification unavailable')
    );

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(mockVerifyPaystack).not.toHaveBeenCalled();
    expect(mockRunPaidOrderSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayResponse: { fees: 123, status: 'success' },
      })
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.objectContaining({ p_transaction_id: 'txn-1' })
    );
  });

  it('re-verifies Paystack before draining a locally paid order without stored gateway evidence', async () => {
    const supabase = buildSupabase({
      completion: {
        already_completed: true,
        cancelled_at: null,
        order_already_paid: true,
        order_cancelled: false,
        order_number: 'ORD-1',
        order_updated: false,
        payment_status: 'paid',
        previous_payment_status: 'paid',
        previous_shipping_status: 'processing',
        shipping_status: 'processing',
      },
      existingOrderStatus: 'paid',
      gatewayResponse: null,
      transactionStatus: 'completed',
    });
    mockCreateServiceClient.mockReturnValue(supabase);

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(mockVerifyPaystack).toHaveBeenCalledWith(REFERENCE);
    expect(mockRunPaidOrderSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayResponse: {
          amount: 100_000,
          currency: 'NGN',
          status: 'success',
        },
      })
    );
  });

  it('returns local success for a completed Juicyway payment', async () => {
    const supabase = buildSupabase({
      completion: null,
      existingOrderStatus: 'paid',
      gateway: 'juicyway',
      transactionStatus: 'completed',
    });
    mockCreateServiceClient.mockReturnValue(supabase);

    const response = await POST(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      orderNumber: 'ORD-1',
      status: 'success',
      success: true,
    });
    expect(mockVerifyPaystack).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith(
      'confirm_order_inventory_reservations',
      { p_merchant_id: 'merchant-1', p_order_id: 'order-1' }
    );
  });

  it('fails closed when completed Juicyway inventory confirmation fails', async () => {
    const supabase = buildSupabase({
      completion: null,
      existingOrderStatus: 'paid',
      gateway: 'juicyway',
      inventoryConfirmationError: { message: 'db unavailable' },
      transactionStatus: 'completed',
    });
    mockCreateServiceClient.mockReturnValue(supabase);

    const response = await POST(createRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: 'INVENTORY_CONFIRMATION_FAILED',
      error: 'Inventory confirmation failed',
    });
  });
});
