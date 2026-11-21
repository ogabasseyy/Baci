import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  verifyTransaction: vi.fn(),
  applyPaidOrderSideEffects: vi.fn(),
  completeOrderGatewayPayment: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));
vi.mock('@/lib/paystack', () => ({
  verifyTransaction: mocks.verifyTransaction,
}));
vi.mock('@/lib/payments/apply-paid-order-side-effects', () => ({
  applyPaidOrderSideEffects: mocks.applyPaidOrderSideEffects,
}));
vi.mock('@/lib/payments/complete-order-gateway-payment', () => ({
  completeOrderGatewayPayment: mocks.completeOrderGatewayPayment,
}));

import { runReconcilePaystackDvaCli } from '@/scripts/reconcile-paystack-dva';
import {
  createSupabaseMock,
  efosaArgs,
  verifySuccess,
} from '@/scripts/reconcile-paystack-dva-fixtures';

describe('runReconcilePaystackDvaCli — happy path (incident shape)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.completeOrderGatewayPayment.mockResolvedValue({
      ok: true,
      completion: {
        actor: 'script:reconcile-paystack-dva',
        already_completed: true,
        cancelled_at: null,
        order_already_paid: true,
        order_cancelled: false,
        order_number: 'ORD-260509-00NV-R',
        order_skipped_status: null,
        order_updated: false,
        payment_status: 'paid',
        previous_payment_status: 'paid',
        previous_shipping_status: 'processing',
        shipping_status: 'processing',
      },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('verifies, calls the atomic RPC, and runs the outbox helper with the incident cancel list', async () => {
    const { supabase } = createSupabaseMock({});
    mocks.createServiceClient.mockReturnValue(supabase);
    mocks.verifyTransaction.mockResolvedValue(verifySuccess);
    mocks.applyPaidOrderSideEffects.mockResolvedValue({
      ranSteps: [
        'paid_email',
        'ad_tracking_conversion',
        'merchant_settlement',
      ],
      skippedSteps: [],
      failedSteps: [
        { step: 'firs_invoice', error: 'financial_totals_inconsistent' },
        { step: 'loyalty_points', error: 'financial_totals_inconsistent' },
      ],
      concurrentTakeoverSteps: [],
    });

    const exit = await runReconcilePaystackDvaCli(efosaArgs);

    expect(exit).toBe(0);
    expect(mocks.verifyTransaction).toHaveBeenCalledWith(
      '100026260509110323000058369193'
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'claim_paystack_paid_atomic',
      expect.objectContaining({
        p_transaction_id: '427ec4ea-b41d-4058-aaf9-3de57ee5fa35',
        p_paystack_reference: '100026260509110323000058369193',
        p_canonical_order_id: '211bcf0e-0795-488f-aeeb-52c5b7a8b9ae',
        p_operator_user_id: '11111111-1111-4111-8111-111111111111',
        p_cancel_order_ids: [
          '9235a8d5-55fc-4e90-8238-4bb6698679bd',
          'de838a51-d0e9-4438-9f55-135b7677783f',
          'a259300d-aef4-44f2-9506-22b47fab756d',
        ],
        p_operator_label: 'script:reconcile-paystack-dva',
      })
    );
    const rpcCall = supabase.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect((rpcCall.p_gateway_response as Record<string, unknown>).reference).toBe(
      '100026260509110323000058369193'
    );

    expect(mocks.completeOrderGatewayPayment).toHaveBeenCalledWith({
      supabase,
      transactionId: '427ec4ea-b41d-4058-aaf9-3de57ee5fa35',
      orderId: '211bcf0e-0795-488f-aeeb-52c5b7a8b9ae',
      gatewayResponse: verifySuccess.data,
      merchantId: 'merchant-1',
      actor: 'script:reconcile-paystack-dva',
    });

    expect(mocks.applyPaidOrderSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase,
        actor: 'script:reconcile-paystack-dva',
        executors: expect.objectContaining({
          paid_email: expect.any(Function),
          ad_tracking_conversion: expect.any(Function),
          merchant_settlement: expect.any(Function),
          firs_invoice: expect.any(Function),
          loyalty_points: expect.any(Function),
        }),
      })
    );
  });

  // Δ-86: the script forwards the cancel array verbatim. Tenant
  // scoping happens INSIDE the RPC (migration 20260510170000); this
  // test pins the script-side contract that the operator-supplied
  // array reaches the RPC unmodified.
  it('forwards cancel-orders to the RPC unmodified and surfaces RPC-reported counts', async () => {
    const { supabase } = createSupabaseMock({
      rpcResult: {
        data: {
          canonical_order_id: '211bcf0e-0795-488f-aeeb-52c5b7a8b9ae',
          reconciled_at: '2026-05-10T19:00:00Z',
          already_completed: false,
          order_already_paid: false,
          txn_rows_updated: 1,
          order_rows_updated: 1,
          // RPC matched only 2 of 3 supplied cancel_order_ids — the
          // third belonged to another merchant and was filtered out by
          // the merchant_id predicate. Counts come through the RPC
          // return value, not through any client logic.
          dup_orders_cancelled: 2,
          dup_txns_cancelled: 2,
        },
        error: null,
      },
    });
    mocks.createServiceClient.mockReturnValue(supabase);
    mocks.verifyTransaction.mockResolvedValue(verifySuccess);
    mocks.applyPaidOrderSideEffects.mockResolvedValue({
      ranSteps: ['paid_email', 'ad_tracking_conversion', 'merchant_settlement'],
      skippedSteps: [],
      failedSteps: [],
      concurrentTakeoverSteps: [],
    });

    const exit = await runReconcilePaystackDvaCli(efosaArgs);

    expect(exit).toBe(0);
    const rpcCall = supabase.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(rpcCall.p_cancel_order_ids).toEqual([
      '9235a8d5-55fc-4e90-8238-4bb6698679bd',
      'de838a51-d0e9-4438-9f55-135b7677783f',
      'a259300d-aef4-44f2-9506-22b47fab756d',
    ]);
  });
});

describe('runReconcilePaystackDvaCli — Paystack guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits non-zero and skips the RPC when Paystack verify fails', async () => {
    const { supabase } = createSupabaseMock({});
    mocks.createServiceClient.mockReturnValue(supabase);
    mocks.verifyTransaction.mockResolvedValue({
      success: false,
      error: 'Paystack down',
      code: 'NETWORK_ERROR',
    });

    const exit = await runReconcilePaystackDvaCli(efosaArgs);

    expect(exit).toBe(1);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(mocks.applyPaidOrderSideEffects).not.toHaveBeenCalled();
  });

  it('exits non-zero when Paystack reports a non-success status', async () => {
    const { supabase } = createSupabaseMock({});
    mocks.createServiceClient.mockReturnValue(supabase);
    mocks.verifyTransaction.mockResolvedValue({
      success: true,
      data: { ...verifySuccess.data, status: 'failed' },
    });

    const exit = await runReconcilePaystackDvaCli(efosaArgs);

    expect(exit).toBe(1);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('exits non-zero when verified amount does not match on-record txn', async () => {
    const { supabase } = createSupabaseMock({});
    mocks.createServiceClient.mockReturnValue(supabase);
    mocks.verifyTransaction.mockResolvedValue({
      success: true,
      data: { ...verifySuccess.data, amount: 100 }, // ₦1
    });

    const exit = await runReconcilePaystackDvaCli(efosaArgs);

    expect(exit).toBe(1);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe('runReconcilePaystackDvaCli — RPC failure modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.completeOrderGatewayPayment.mockResolvedValue({
      ok: true,
      completion: {
        actor: 'script:reconcile-paystack-dva',
        already_completed: true,
        cancelled_at: null,
        order_already_paid: true,
        order_cancelled: false,
        order_number: 'ORD-260509-00NV-R',
        order_skipped_status: null,
        order_updated: false,
        payment_status: 'paid',
        previous_payment_status: 'paid',
        previous_shipping_status: 'processing',
        shipping_status: 'processing',
      },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits non-zero and skips the outbox when the atomic RPC errors', async () => {
    const { supabase } = createSupabaseMock({
      rpcResult: {
        data: null,
        error: {
          message:
            'transaction_order_link_mismatch: txn X is for order Y, got Z',
        },
      },
    });
    mocks.createServiceClient.mockReturnValue(supabase);
    mocks.verifyTransaction.mockResolvedValue(verifySuccess);

    const exit = await runReconcilePaystackDvaCli(efosaArgs);

    expect(exit).toBe(1);
    expect(mocks.applyPaidOrderSideEffects).not.toHaveBeenCalled();
  });

  it('idempotent replay: returns exit 0 when already_completed=true', async () => {
    const { supabase } = createSupabaseMock({
      rpcResult: {
        data: {
          canonical_order_id: '211bcf0e-0795-488f-aeeb-52c5b7a8b9ae',
          reconciled_at: '2026-05-10T18:30:00Z',
          already_completed: true,
          order_already_paid: true,
          txn_rows_updated: 0,
          order_rows_updated: 0,
          dup_orders_cancelled: 0,
          dup_txns_cancelled: 0,
        },
        error: null,
      },
    });
    mocks.createServiceClient.mockReturnValue(supabase);
    mocks.verifyTransaction.mockResolvedValue(verifySuccess);
    mocks.applyPaidOrderSideEffects.mockResolvedValue({
      ranSteps: [],
      skippedSteps: [
        'paid_email',
        'ad_tracking_conversion',
        'merchant_settlement',
      ],
      failedSteps: [],
      concurrentTakeoverSteps: [],
    });

    const exit = await runReconcilePaystackDvaCli(efosaArgs);

    expect(exit).toBe(0);
    expect(mocks.applyPaidOrderSideEffects).toHaveBeenCalledTimes(1);
  });
});
