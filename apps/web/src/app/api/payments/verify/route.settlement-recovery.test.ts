import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verificationRouteFixtures } from './route.cancellation.test-support';

const {
  POST,
  createRequest,
  buildSupabase,
  mockCreateServiceClient,
  mockVerifyPaystack,
  mockRunPaidOrderSideEffects,
  mockProcessMerchantInvoicePartialPayment,
  mockCaptureOrHoldRedvaultPayment,
  mockNotifyNewOrder,
  REFERENCE,
} = verificationRouteFixtures;

describe('POST /api/payments/verify — settlement recovery', () => {
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
});
