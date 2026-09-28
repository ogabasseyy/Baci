import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drainFailedPaidOrderSideEffects } from '@/lib/payments/drain-failed-paid-order-side-effects';
import { drainFailedPaidOrderSideEffectsTestKit } from '@/lib/payments/drain-failed-paid-order-side-effects.test-helpers';

const mocks = vi.hoisted(() => ({
  finalizeOrderGatewayPayment: vi.fn(),
  recoverStrandedPaidOrderSideEffects: vi.fn(),
  retireTerminalSideEffectDrain: vi.fn(),
  verifyGatewayCharge: vi.fn(),
}));

vi.mock('@/lib/payments/finalize-order-gateway-payment', () => ({
  finalizeOrderGatewayPayment: mocks.finalizeOrderGatewayPayment,
}));
vi.mock('@/lib/payments/recover-stranded-paid-order-side-effects', () => ({
  recoverStrandedPaidOrderSideEffects:
    mocks.recoverStrandedPaidOrderSideEffects,
}));
vi.mock('@/lib/payments/verify-gateway-charge', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/payments/verify-gateway-charge')
    >();
  return { ...actual, verifyGatewayCharge: mocks.verifyGatewayCharge };
});
vi.mock('@/lib/payments/retire-terminal-side-effect-drain', () => ({
  retireTerminalSideEffectDrain: mocks.retireTerminalSideEffectDrain,
}));

const { buildSupabase, failedRow } = drainFailedPaidOrderSideEffectsTestKit;

const scheduleAfter = (task: () => Promise<void>) => {
  void task();
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recoverStrandedPaidOrderSideEffects.mockResolvedValue({
    recovered: [],
    stranded: [],
  });
});

describe('drainFailedPaidOrderSideEffects verification', () => {
  it('drains Juicyway side effects after cron-based finalization', async () => {
    const juicywayRow = {
      ...failedRow,
      transactions: {
        ...failedRow.transactions,
        gateway: 'juicyway',
        gateway_response: null,
        metadata: {
          juicyway_expected_amount: 50_000,
          juicyway_expected_currency: 'USDT',
          session_id: '550e8400-e29b-41d4-a716-446655440000',
        },
      },
    };
    const supabase = buildSupabase({ data: [juicywayRow] });
    mocks.verifyGatewayCharge.mockResolvedValue({
      amount: 50_000,
      currency: 'USDT',
      ok: true,
      response: { status: 'succeeded' },
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    const summary = await drainFailedPaidOrderSideEffects({
      scheduleAfter,
      supabase,
    });

    expect(summary.drained).toEqual([{ orderId: 'order-1' }]);
    expect(mocks.verifyGatewayCharge).toHaveBeenCalledWith(
      'juicyway',
      'REF-1',
      {
        juicywayExpectedAmount: 50_000,
        juicywayExpectedCurrency: 'USDT',
        juicywayHasExpectedSettlementMetadata: true,
        juicywaySessionId: '550e8400-e29b-41d4-a716-446655440000',
        juicywayTransactionCreatedAt: '2026-07-01T00:00:00.000Z',
      },
      undefined
    );
    expect(mocks.finalizeOrderGatewayPayment).toHaveBeenCalledWith(
      expect.objectContaining({ gateway: 'juicyway' })
    );
  });

  it('re-verifies a completed payment without stored gateway evidence', async () => {
    const missingEvidenceRow = {
      ...failedRow,
      transactions: { ...failedRow.transactions, gateway_response: null },
    };
    const supabase = buildSupabase({ data: [missingEvidenceRow] });
    mocks.verifyGatewayCharge.mockResolvedValue({
      amount: 58290.6,
      currency: 'NGN',
      ok: true,
      response: { fees: 123, status: 'success' },
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    const summary = await drainFailedPaidOrderSideEffects({
      scheduleAfter,
      supabase,
    });

    expect(mocks.verifyGatewayCharge).toHaveBeenCalledWith(
      'paystack',
      'REF-1',
      undefined,
      undefined
    );
    expect(mocks.finalizeOrderGatewayPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayResponse: { fees: 123, status: 'success' },
      })
    );
    expect(summary.drained).toEqual([{ orderId: 'order-1' }]);
  });

  it('bounds in-flight verification to the remaining pass share', async () => {
    const missingEvidenceRow = {
      ...failedRow,
      transactions: { ...failedRow.transactions, gateway_response: null },
    };
    const supabase = buildSupabase({ data: [missingEvidenceRow] });
    mocks.verifyGatewayCharge.mockResolvedValue({
      amount: 58290.6,
      currency: 'NGN',
      ok: true,
      response: { fees: 123, status: 'success' },
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_200_000);

    try {
      const summary = await drainFailedPaidOrderSideEffects({
        deadlineMs: 1_270_000,
        scheduleAfter,
        supabase,
      });

      expect(mocks.verifyGatewayCharge).toHaveBeenCalledWith(
        'paystack',
        'REF-1',
        undefined,
        expect.any(AbortSignal)
      );
      expect(summary.drained).toEqual([{ orderId: 'order-1' }]);
    } finally {
      now.mockRestore();
    }
  });

  it('skips when missing gateway evidence cannot be re-verified', async () => {
    const missingEvidenceRow = {
      ...failedRow,
      transactions: { ...failedRow.transactions, gateway_response: null },
    };
    const supabase = buildSupabase({ data: [missingEvidenceRow] });
    mocks.verifyGatewayCharge.mockResolvedValue({
      ok: false,
      reason: 'paystack_verification_unavailable',
    });

    const summary = await drainFailedPaidOrderSideEffects({
      scheduleAfter,
      supabase,
    });

    expect(summary.skipped).toEqual([
      { orderId: 'order-1', reason: 'paystack_verification_unavailable' },
    ]);
    expect(mocks.finalizeOrderGatewayPayment).not.toHaveBeenCalled();
  });

  it('retires terminal verification failures with a durable review', async () => {
    const missingEvidenceRow = {
      ...failedRow,
      transactions: {
        ...failedRow.transactions,
        gateway_response: null,
        metadata: null,
      },
    };
    const supabase = buildSupabase({ data: [missingEvidenceRow] });
    mocks.verifyGatewayCharge.mockResolvedValue({
      gatewayStatus: 'failed',
      ok: false,
      reason: 'gateway_status_not_success',
    });
    mocks.retireTerminalSideEffectDrain.mockResolvedValue(true);

    const summary = await drainFailedPaidOrderSideEffects({
      scheduleAfter,
      supabase,
    });

    expect(mocks.retireTerminalSideEffectDrain).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        resolution: 'gateway_verification_negative',
        transaction: expect.objectContaining({ id: 'txn-1' }),
      })
    );
    expect(summary.skipped).toEqual([
      { orderId: 'order-1', reason: 'gateway_status_not_success' },
    ]);
  });

  it('retires a definitive Juicyway amount mismatch', async () => {
    const missingEvidenceRow = {
      ...failedRow,
      transactions: {
        ...failedRow.transactions,
        gateway: 'juicyway',
        gateway_response: null,
        metadata: {
          juicyway_expected_amount: 50_000,
          juicyway_expected_currency: 'USDT',
          session_id: '550e8400-e29b-41d4-a716-446655440000',
        },
      },
    };
    const supabase = buildSupabase({ data: [missingEvidenceRow] });
    mocks.verifyGatewayCharge.mockResolvedValue({
      ok: false,
      reason: 'amount_mismatch',
    });
    mocks.retireTerminalSideEffectDrain.mockResolvedValue(true);

    const summary = await drainFailedPaidOrderSideEffects({
      scheduleAfter,
      supabase,
    });

    expect(mocks.retireTerminalSideEffectDrain).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        resolution: 'amount_mismatch',
        transaction: expect.objectContaining({
          gateway: 'juicyway',
          id: 'txn-1',
        }),
      })
    );
    expect(summary.skipped).toEqual([
      { orderId: 'order-1', reason: 'amount_mismatch' },
    ]);
    expect(mocks.finalizeOrderGatewayPayment).not.toHaveBeenCalled();
  });
});
