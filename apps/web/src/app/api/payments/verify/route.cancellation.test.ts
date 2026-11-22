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
  mockReconciliationInsert,
  REFERENCE,
} = verificationRouteFixtures;

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
    expect(data).toMatchObject({
      finalizationOutcome: 'order_cancelled',
      status: 'success',
      success: true,
    });
    expect(mockNotifyNewOrder).not.toHaveBeenCalled();
    expect(mockRunPaidOrderSideEffects).not.toHaveBeenCalled();
    expect(mockReconciliationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'payment_received_after_cancellation',
        order_id: 'order-1',
      })
    );
  });

  it('returns the trusted order identity with terminal provider outcomes', async () => {
    mockVerifyPaystack.mockResolvedValue({
      data: { amount: 100_000, currency: 'NGN', status: 'failed' },
      success: true,
    });
    const supabase = buildSupabase({ completion: null });
    mockCreateServiceClient.mockReturnValue(supabase);

    const response = await POST(createRequest());
    const data = await response.json();

    // Clients attribute this success:false envelope to their order via
    // orderId instead of treating it as transient and confirming a
    // payment that cannot settle.
    expect(response.status).toBe(200);
    expect(data).toEqual({
      orderId: 'order-1',
      orderNumber: 'ORD-1',
      status: 'failed',
      success: false,
    });
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
      currency: 'NGN',
      finalizationOutcome: 'completed',
      orderId: 'order-1',
      orderNumber: 'ORD-1',
      orderTotal: 21500,
      paymentMethod: 'juicyway',
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
