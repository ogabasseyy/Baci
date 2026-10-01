import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';
import {
  baseArgs,
  buildSupabase,
  completion,
  richOrderRow,
} from '@/lib/payments/finalize-order-gateway-payment-fixtures';

const mocks = vi.hoisted(() => ({
  completeOrderGatewayPayment: vi.fn(),
  clearPaymentSideEffectSeed: vi.fn(),
  settleCapturedOrderPayment: vi.fn(),
  ensurePaidOrderInventoryConfirmed: vi.fn(),
  fileInventoryConfirmationFailureReview: vi.fn(),
  handlePaymentForCancelledOrder: vi.fn(),
  captureOrHoldRedvaultPayment: vi.fn(),
  notifyNewOrder: vi.fn(),
  notifyPaymentReceived: vi.fn(),
  persistPaidOrderSideEffectRetry: vi.fn(),
  rollbackOrderStatusAfterInventoryConfirmationFailure: vi.fn(),
  runPaidOrderSideEffects: vi.fn(),
}));

vi.mock('@/lib/payments/clear-payment-side-effect-seed', () => ({
  clearPaymentSideEffectSeed: mocks.clearPaymentSideEffectSeed,
}));

vi.mock(
  '@/lib/payments/complete-order-gateway-payment',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    completeOrderGatewayPayment: mocks.completeOrderGatewayPayment,
  })
);
vi.mock(
  '@/lib/payments/ensure-paid-order-inventory-confirmed',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    ensurePaidOrderInventoryConfirmed: mocks.ensurePaidOrderInventoryConfirmed,
    rollbackOrderStatusAfterInventoryConfirmationFailure:
      mocks.rollbackOrderStatusAfterInventoryConfirmationFailure,
  })
);
vi.mock('@/lib/payments/file-inventory-confirmation-review', () => ({
  fileInventoryConfirmationFailureReview:
    mocks.fileInventoryConfirmationFailureReview,
}));
vi.mock('@/lib/payments/redvault-capture-hold', () => ({
  captureOrHoldRedvaultPayment: mocks.captureOrHoldRedvaultPayment,
}));
vi.mock('@/lib/payments/handle-payment-for-cancelled-order', () => ({
  handlePaymentForCancelledOrder: mocks.handlePaymentForCancelledOrder,
}));
vi.mock('@/lib/expo-push', () => ({
  notifyNewOrder: mocks.notifyNewOrder,
  notifyPaymentReceived: mocks.notifyPaymentReceived,
}));
vi.mock(
  '@/lib/payments/paid-order-retry-persistence',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    persistPaidOrderSideEffectRetry: mocks.persistPaidOrderSideEffectRetry,
  })
);
vi.mock('@/lib/payments/run-paid-order-side-effects', () => ({
  runPaidOrderSideEffects: mocks.runPaidOrderSideEffects,
}));
vi.mock('@/lib/payments/settle-captured-order-payment', () => ({
  settleCapturedOrderPayment: mocks.settleCapturedOrderPayment,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clearPaymentSideEffectSeed.mockResolvedValue(undefined);
  mocks.captureOrHoldRedvaultPayment.mockResolvedValue({
    kind: 'not_redvault',
  });
  // Reviews file durably by default; a false return means the ops row could
  // not be written, which callers must treat as a retryable failure.
  mocks.handlePaymentForCancelledOrder.mockResolvedValue(true);
  mocks.runPaidOrderSideEffects.mockResolvedValue({
    concurrentTakeoverSteps: [],
    failedSteps: [],
    ranSteps: ['merchant_settlement'],
    skippedSteps: [],
  });
});

describe('finalizeOrderGatewayPayment', () => {
  it('holds a REDVAULT capture before every paid-order branch', async () => {
    mocks.captureOrHoldRedvaultPayment.mockResolvedValue({
      duplicate: false,
      kind: 'captured_held',
      reason: 'provider_eligibility_evidence_unavailable',
    });

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({ data: richOrderRow }), {
        wonTransactionFlip: true,
      })
    );

    expect(outcome).toEqual({
      duplicate: false,
      kind: 'captured_held',
      reason: 'provider_eligibility_evidence_unavailable',
    });
    expect(mocks.completeOrderGatewayPayment).not.toHaveBeenCalled();
    expect(mocks.ensurePaidOrderInventoryConfirmed).not.toHaveBeenCalled();
    expect(mocks.runPaidOrderSideEffects).not.toHaveBeenCalled();
    expect(mocks.settleCapturedOrderPayment).not.toHaveBeenCalled();
  });

  it('fails closed before the already-paid settlement-only fallback when REDVAULT holding fails', async () => {
    mocks.captureOrHoldRedvaultPayment.mockRejectedValue(
      new Error('redvault capture RPC unavailable')
    );

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({ data: richOrderRow }), {
        wonTransactionFlip: false,
      })
    );

    expect(outcome.kind).toBe('capture_hold_failed');
    expect(mocks.completeOrderGatewayPayment).not.toHaveBeenCalled();
    expect(mocks.settleCapturedOrderPayment).not.toHaveBeenCalled();
  });

  it('returns completion_failed when the atomic RPC fails', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue({
      error: new Error('boom'),
      ok: false,
    });

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({}))
    );

    expect(outcome.kind).toBe('completion_failed');
    expect(mocks.runPaidOrderSideEffects).not.toHaveBeenCalled();
  });

  it('returns completion_failed on an RPC-level error code', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({ error_code: 'ORDER_NOT_FOUND' })
    );

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({}))
    );

    expect(outcome.kind).toBe('completion_failed');
  });

  it('stops an already-recorded strict partial before paid-order side effects', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({
        merchant_invoice_partial_recorded: true,
        order_number: 'ORD-PARTIAL',
        order_updated: false,
      })
    );

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({}))
    );

    expect(outcome).toEqual({
      kind: 'partial_recorded',
      orderNumber: 'ORD-PARTIAL',
    });
    expect(mocks.runPaidOrderSideEffects).not.toHaveBeenCalled();
  });

  it('files a cancellation review and suppresses side effects for cancelled orders', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({
        cancelled_at: '2026-07-01T00:00:00Z',
        order_cancelled: true,
        order_updated: false,
      })
    );

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({}))
    );

    expect(outcome.kind).toBe('order_cancelled');
    expect(mocks.handlePaymentForCancelledOrder).toHaveBeenCalledTimes(1);
    expect(mocks.runPaidOrderSideEffects).not.toHaveBeenCalled();
  });

  it('skips refunded orders but files a durable reconciliation review', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({ order_skipped_status: 'refunded', order_updated: false })
    );

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({}))
    );

    expect(outcome).toEqual({
      kind: 'order_skipped',
      paymentStatus: 'refunded',
    });
    expect(mocks.handlePaymentForCancelledOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        issueType: 'payment_received_after_refund',
        order: { id: 'order-1' },
      })
    );
    expect(mocks.runPaidOrderSideEffects).not.toHaveBeenCalled();
  });

  it('fails closed when a blocked-order review cannot be filed', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({
        cancelled_at: '2026-07-01T00:00:00Z',
        order_cancelled: true,
        order_updated: false,
      })
    );
    mocks.handlePaymentForCancelledOrder.mockResolvedValue(false);

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({}))
    );

    // No durable ops row: the caller must retry, never retire this payment.
    expect(outcome).toEqual({ kind: 'review_failed' });
    expect(mocks.runPaidOrderSideEffects).not.toHaveBeenCalled();
  });

  it('completes the happy path: inventory, push, and side effects', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(completion());
    mocks.ensurePaidOrderInventoryConfirmed.mockResolvedValue(undefined);

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({ data: richOrderRow }))
    );

    expect(outcome).toEqual({
      healed: false,
      kind: 'completed',
      orderNumber: null,
    });
    expect(mocks.ensurePaidOrderInventoryConfirmed).toHaveBeenCalledWith(
      expect.anything(),
      'merchant-1',
      'order-1'
    );
    expect(mocks.notifyPaymentReceived).toHaveBeenCalled();
    expect(mocks.runPaidOrderSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        externalGatewayReference: 'REF',
        settlementGateway: 'paystack',
        transaction: expect.objectContaining({
          id: 'txn-1',
          platform_fee: 1165.81,
        }),
      })
    );
  });

  it('flags a heal when the transaction was completed earlier', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({ already_completed: true })
    );
    mocks.ensurePaidOrderInventoryConfirmed.mockResolvedValue(undefined);

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({ data: richOrderRow }), {
        wonTransactionFlip: false,
      })
    );

    expect(outcome).toMatchObject({ healed: true, kind: 'completed' });
    expect(mocks.notifyPaymentReceived).toHaveBeenCalled();
  });

  it('drains side effects without push on a pure replay', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({
        already_completed: true,
        order_already_paid: true,
        order_updated: false,
      })
    );
    mocks.ensurePaidOrderInventoryConfirmed.mockResolvedValue(undefined);

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({ data: richOrderRow }), {
        wonTransactionFlip: false,
      })
    );

    expect(outcome).toMatchObject({ healed: false, kind: 'completed' });
    expect(mocks.notifyNewOrder).not.toHaveBeenCalled();
    expect(mocks.notifyPaymentReceived).not.toHaveBeenCalled();
    expect(mocks.runPaidOrderSideEffects).toHaveBeenCalledTimes(1);
  });

  it('sends the missed push when only the untouched RPC seed row exists', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({
        already_completed: true,
        order_already_paid: true,
        order_updated: false,
      })
    );
    mocks.ensurePaidOrderInventoryConfirmed.mockResolvedValue(undefined);

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(
        buildSupabase(
          { data: richOrderRow },
          {
            outboxRows: [
              {
                error: 'rpc_seed_pending_drain',
                status: 'failed',
                step: 'merchant_settlement',
                transaction_id: 'txn-1',
              },
            ],
          }
        ),
        { wonTransactionFlip: false }
      )
    );

    expect(outcome).toMatchObject({ kind: 'completed' });
    // The transitioning caller crashed before scheduling push (the seed row
    // is untouched), so this replay owes the merchant their notifications.
    expect(mocks.notifyPaymentReceived).toHaveBeenCalled();
    expect(mocks.runPaidOrderSideEffects).toHaveBeenCalledTimes(1);
  });

  it('skips the drain on a pure replay with no outbox history (legacy completion)', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({
        already_completed: true,
        order_already_paid: true,
        order_updated: false,
      })
    );
    mocks.ensurePaidOrderInventoryConfirmed.mockResolvedValue(undefined);

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({ data: richOrderRow }, { outboxRows: [] }), {
        wonTransactionFlip: false,
      })
    );

    expect(outcome).toMatchObject({ healed: false, kind: 'completed' });
    expect(mocks.ensurePaidOrderInventoryConfirmed).toHaveBeenCalledWith(
      expect.anything(),
      'merchant-1',
      'order-1'
    );
    // Pre-outbox completions sent email/settlement inline; draining an empty
    // outbox would duplicate them.
    expect(mocks.runPaidOrderSideEffects).not.toHaveBeenCalled();
  });

  it('settles a fresh capture on a legacy paid order with no outbox history', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({
        already_completed: true,
        order_already_paid: true,
        order_updated: false,
      })
    );
    mocks.ensurePaidOrderInventoryConfirmed.mockResolvedValue(undefined);

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({ data: richOrderRow }, { outboxRows: [] }), {
        wonTransactionFlip: true,
      })
    );

    expect(outcome).toMatchObject({ kind: 'completed' });
    expect(mocks.ensurePaidOrderInventoryConfirmed).not.toHaveBeenCalled();
    expect(mocks.settleCapturedOrderPayment).toHaveBeenCalledTimes(1);
    expect(mocks.runPaidOrderSideEffects).not.toHaveBeenCalled();
    expect(mocks.notifyPaymentReceived).not.toHaveBeenCalled();
  });

  it('settles only (no email/push) when the order was paid by another transaction', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({
        already_completed: false,
        order_already_paid: true,
        order_updated: false,
      })
    );
    mocks.ensurePaidOrderInventoryConfirmed.mockResolvedValue(undefined);

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(
        buildSupabase(
          { data: richOrderRow },
          // Outbox belongs to a DIFFERENT (paying) transaction.
          { outboxRows: [{ order_id: 'order-1', transaction_id: 'txn-other' }] }
        ),
        { wonTransactionFlip: false }
      )
    );

    expect(outcome).toMatchObject({ kind: 'completed' });
    expect(mocks.ensurePaidOrderInventoryConfirmed).not.toHaveBeenCalled();
    // The customer was already confirmed for the paying transaction: these
    // captured funds owe settlement only, outside the order-scoped outbox.
    expect(mocks.settleCapturedOrderPayment).toHaveBeenCalledTimes(1);
    expect(mocks.runPaidOrderSideEffects).not.toHaveBeenCalled();
    expect(mocks.notifyPaymentReceived).not.toHaveBeenCalled();
  });

  it('settles only when the webhook itself captures onto an already-paid order', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({
        already_completed: true,
        order_already_paid: true,
        order_updated: false,
      })
    );
    mocks.ensurePaidOrderInventoryConfirmed.mockResolvedValue(undefined);

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(
        buildSupabase(
          { data: richOrderRow },
          { outboxRows: [{ order_id: 'order-1', transaction_id: 'txn-other' }] }
        ),
        // The webhook won the outer CAS on THIS transaction, but another
        // channel had already paid the order.
        { wonTransactionFlip: true }
      )
    );

    expect(outcome).toMatchObject({ kind: 'completed' });
    expect(mocks.ensurePaidOrderInventoryConfirmed).not.toHaveBeenCalled();
    expect(mocks.settleCapturedOrderPayment).toHaveBeenCalledTimes(1);
    expect(mocks.runPaidOrderSideEffects).not.toHaveBeenCalled();
    expect(mocks.notifyPaymentReceived).not.toHaveBeenCalled();
  });

  it('settles a capture even when the paying transaction has fresh pre-push evidence', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({
        already_completed: true,
        order_already_paid: true,
        order_updated: false,
      })
    );

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(
        buildSupabase(
          { data: richOrderRow },
          {
            outboxRows: [
              {
                claimed_at: new Date().toISOString(),
                error: 'rpc_seed_pending_drain',
                result: null,
                status: 'failed',
                step: 'merchant_settlement',
                transaction_id: 'txn-other',
              },
            ],
          }
        ),
        { wonTransactionFlip: true }
      )
    );

    expect(outcome).toMatchObject({ kind: 'completed' });
    expect(mocks.settleCapturedOrderPayment).toHaveBeenCalledTimes(1);
    expect(mocks.ensurePaidOrderInventoryConfirmed).not.toHaveBeenCalled();
  });

  it('fails closed when an already-paid capture cannot inspect the payer outbox', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({
        already_completed: true,
        order_already_paid: true,
        order_updated: false,
      })
    );
    mocks.ensurePaidOrderInventoryConfirmed.mockResolvedValue(undefined);

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(
        buildSupabase(
          { data: richOrderRow },
          { outboxError: { message: 'outbox unavailable' } }
        ),
        { wonTransactionFlip: false }
      )
    );

    expect(outcome).toMatchObject({ kind: 'completion_failed' });
    expect(mocks.runPaidOrderSideEffects).not.toHaveBeenCalled();
    expect(mocks.settleCapturedOrderPayment).not.toHaveBeenCalled();
  });

  it('returns order_fetch_failed and persists retry markers so the cron drain can find the order', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(completion());
    mocks.persistPaidOrderSideEffectRetry.mockResolvedValue(undefined);

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({ error: { message: 'network' } }))
    );

    expect(outcome.kind).toBe('order_fetch_failed');
    expect(mocks.persistPaidOrderSideEffectRetry).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', reference: 'REF' })
    );
    expect(mocks.runPaidOrderSideEffects).not.toHaveBeenCalled();
  });

  it('does not write retry markers when a pure replay fails the order fetch', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({
        already_completed: true,
        order_already_paid: true,
        order_updated: false,
      })
    );

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({ error: { message: 'network' } }), {
        wonTransactionFlip: false,
      })
    );

    expect(outcome.kind).toBe('order_fetch_failed');
    expect(mocks.persistPaidOrderSideEffectRetry).not.toHaveBeenCalled();
  });

  it('files settlement-only recovery outside the order outbox when its order fetch fails', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({
        already_completed: true,
        order_already_paid: true,
        order_updated: false,
      })
    );

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(
        buildSupabase(
          { error: { message: 'network' } },
          { outboxRows: [{ order_id: 'order-1', transaction_id: 'txn-other' }] }
        ),
        { wonTransactionFlip: true }
      )
    );

    expect(outcome.kind).toBe('order_fetch_failed');
    expect(mocks.handlePaymentForCancelledOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        issueType: 'merchant_settlement_failed',
        order: { id: 'order-1' },
      })
    );
    expect(mocks.persistPaidOrderSideEffectRetry).not.toHaveBeenCalled();
  });

  it('files settlement-only recovery outside the order outbox when normalization fails', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({
        already_completed: true,
        order_already_paid: true,
        order_updated: false,
      })
    );
    mocks.ensurePaidOrderInventoryConfirmed.mockResolvedValue(undefined);

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(
        buildSupabase(
          { data: { ...richOrderRow, total: 'not-a-number' } },
          { outboxRows: [{ order_id: 'order-1', transaction_id: 'txn-other' }] }
        ),
        { wonTransactionFlip: true }
      )
    );

    expect(outcome.kind).toBe('order_fetch_failed');
    expect(mocks.handlePaymentForCancelledOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        issueType: 'merchant_settlement_failed',
        order: { id: 'order-1' },
      })
    );
    expect(mocks.persistPaidOrderSideEffectRetry).not.toHaveBeenCalled();
  });

  it('rolls back to the RPC-reported previous statuses on inventory failure', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({ previous_payment_status: 'partially_paid' })
    );
    mocks.ensurePaidOrderInventoryConfirmed.mockRejectedValue(
      new Error('inventory down')
    );
    mocks.rollbackOrderStatusAfterInventoryConfirmationFailure.mockResolvedValue(
      undefined
    );

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({ data: richOrderRow }))
    );

    expect(outcome.kind).toBe('inventory_failed');
    expect(
      mocks.rollbackOrderStatusAfterInventoryConfirmationFailure
    ).toHaveBeenCalledWith(expect.anything(), 'merchant-1', 'order-1', {
      payment_status: 'partially_paid',
      shipping_status: 'pending',
    });
  });

  it('does not roll back a replay whose order was already paid before this call', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({
        already_completed: true,
        order_already_paid: true,
        order_updated: false,
      })
    );
    mocks.ensurePaidOrderInventoryConfirmed.mockRejectedValue(
      new Error('inventory down')
    );

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({ data: richOrderRow }), {
        wonTransactionFlip: false,
      })
    );

    expect(outcome.kind).toBe('inventory_failed');
    expect(
      mocks.rollbackOrderStatusAfterInventoryConfirmationFailure
    ).not.toHaveBeenCalled();
  });

  it('files a review and fails closed when rollback also fails', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(completion());
    mocks.ensurePaidOrderInventoryConfirmed.mockRejectedValue(
      new Error('inventory down')
    );
    mocks.rollbackOrderStatusAfterInventoryConfirmationFailure.mockRejectedValue(
      new Error('rollback down')
    );

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({ data: richOrderRow }))
    );

    expect(outcome.kind).toBe('inventory_cleanup_failed');
    expect(mocks.fileInventoryConfirmationFailureReview).toHaveBeenCalled();
  });

  it('files a distinct review when rollback succeeds but seed cleanup fails', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(completion());
    mocks.ensurePaidOrderInventoryConfirmed.mockRejectedValue(
      new Error('inventory down')
    );
    mocks.rollbackOrderStatusAfterInventoryConfirmationFailure.mockResolvedValue(
      undefined
    );
    mocks.clearPaymentSideEffectSeed.mockRejectedValue(
      new Error('seed cleanup down')
    );

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({ data: richOrderRow }))
    );

    expect(outcome.kind).toBe('inventory_cleanup_failed');
    expect(mocks.fileInventoryConfirmationFailureReview).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          seedCleanupError: 'seed cleanup down',
          source: 'gateway_payment_finalizer_seed_cleanup',
        }),
      })
    );
  });

  it('persists a retry marker instead of failing when side effects throw', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(completion());
    mocks.ensurePaidOrderInventoryConfirmed.mockResolvedValue(undefined);
    mocks.runPaidOrderSideEffects.mockRejectedValue(new Error('zepto down'));
    mocks.persistPaidOrderSideEffectRetry.mockResolvedValue(undefined);

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(buildSupabase({ data: richOrderRow }))
    );

    expect(outcome.kind).toBe('completed');
    expect(mocks.persistPaidOrderSideEffectRetry).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', reference: 'REF' })
    );
  });

  it('files a durable review without overwriting the order outbox when settlement-only work fails', async () => {
    mocks.completeOrderGatewayPayment.mockResolvedValue(
      completion({
        already_completed: true,
        order_already_paid: true,
        order_updated: false,
      })
    );
    mocks.ensurePaidOrderInventoryConfirmed.mockResolvedValue(undefined);
    mocks.settleCapturedOrderPayment.mockRejectedValue(
      new Error('settlement unavailable')
    );

    const outcome = await finalizeOrderGatewayPayment(
      baseArgs(
        buildSupabase(
          { data: richOrderRow },
          { outboxRows: [{ order_id: 'order-1', transaction_id: 'txn-other' }] }
        ),
        { wonTransactionFlip: true }
      )
    );

    expect(outcome.kind).toBe('completion_failed');
    expect(mocks.handlePaymentForCancelledOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        issueType: 'merchant_settlement_failed',
        order: { id: 'order-1' },
        transactionId: 'txn-1',
      })
    );
    expect(mocks.persistPaidOrderSideEffectRetry).not.toHaveBeenCalled();
  });
});
