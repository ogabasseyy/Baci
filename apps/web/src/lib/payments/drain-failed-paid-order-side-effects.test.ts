import type { SupabaseClient } from '@supabase/supabase-js';
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
  return {
    ...actual,
    verifyGatewayCharge: mocks.verifyGatewayCharge,
  };
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

describe('drainFailedPaidOrderSideEffects', () => {
  it('throws when the failed-row lookup errors', async () => {
    const supabase = buildSupabase({ error: { message: 'db down' } });

    await expect(
      drainFailedPaidOrderSideEffects({
        finalizePayment: mocks.finalizeOrderGatewayPayment,
        fileWedgeReview: vi.fn(),
        scheduleAfter,
        supabase,
      })
    ).rejects.toThrow('failed_side_effect_lookup_failed');
  });

  it('returns an empty summary when no failed rows exist', async () => {
    const supabase = buildSupabase({ data: [] });

    const summary = await drainFailedPaidOrderSideEffects({
      finalizePayment: mocks.finalizeOrderGatewayPayment,
      fileWedgeReview: vi.fn(),
      scheduleAfter,
      supabase,
    });

    expect(summary).toEqual({
      drained: [],
      failed: [],
      recovered: [],
      skipped: [],
      stranded: [],
    });
    expect(mocks.finalizeOrderGatewayPayment).not.toHaveBeenCalled();
  });

  it('runs the stranded-row recovery before selecting drain candidates and surfaces its result', async () => {
    const supabase = buildSupabase({ data: [] });
    mocks.recoverStrandedPaidOrderSideEffects.mockResolvedValue({
      recovered: [{ orderId: 'order-9', step: 'paid_email' }],
      stranded: [
        {
          error: 'still_broken',
          orderId: 'order-7',
          step: 'merchant_settlement',
        },
      ],
    });

    const summary = await drainFailedPaidOrderSideEffects({
      finalizePayment: mocks.finalizeOrderGatewayPayment,
      fileWedgeReview: vi.fn(),
      scheduleAfter,
      supabase,
    });

    expect(mocks.recoverStrandedPaidOrderSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ supabase })
    );
    // Recovery MUST run before the drain's candidate SELECT so a row it lifts
    // back below the cap is picked up in the same tick.
    const recoveryOrder =
      mocks.recoverStrandedPaidOrderSideEffects.mock.invocationCallOrder[0];
    const firstSelectOrder = vi.mocked(supabase.from).mock
      .invocationCallOrder[0];
    expect(recoveryOrder).toBeLessThan(firstSelectOrder);
    expect(summary.recovered).toEqual([
      { orderId: 'order-9', step: 'paid_email' },
    ]);
    expect(summary.stranded).toEqual([
      {
        error: 'still_broken',
        orderId: 'order-7',
        step: 'merchant_settlement',
      },
    ]);
  });

  it('re-runs the finalizer once per order and reports the drain', async () => {
    const secondStepSameOrder = { ...failedRow };
    const supabase = buildSupabase({
      data: [failedRow, secondStepSameOrder],
    });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    const summary = await drainFailedPaidOrderSideEffects({
      finalizePayment: mocks.finalizeOrderGatewayPayment,
      fileWedgeReview: vi.fn(),
      scheduleAfter,
      supabase,
    });

    expect(mocks.finalizeOrderGatewayPayment).toHaveBeenCalledTimes(1);
    expect(mocks.finalizeOrderGatewayPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'cron:reconcile-gateway-paid-orders:drain',
        orderId: 'order-1',
        wonTransactionFlip: false,
      })
    );
    expect(summary.drained).toEqual([{ orderId: 'order-1' }]);
    const firstQuery = vi.mocked(supabase.from).mock.results[0]?.value as {
      in: ReturnType<typeof vi.fn>;
      lt: ReturnType<typeof vi.fn>;
    };
    expect(firstQuery.in).toHaveBeenCalledWith('step', [
      'paid_email',
      'ad_tracking_conversion',
      'merchant_settlement',
    ]);
    expect(firstQuery.lt).toHaveBeenCalledWith('attempts', 5);
  });

  it('skips gateways the finalizer cannot handle', async () => {
    const klumpRow = {
      ...failedRow,
      transactions: { ...failedRow.transactions, gateway: 'klump' },
    };
    const supabase = buildSupabase({ data: [klumpRow] });

    const summary = await drainFailedPaidOrderSideEffects({
      finalizePayment: mocks.finalizeOrderGatewayPayment,
      fileWedgeReview: vi.fn(),
      scheduleAfter,
      supabase,
    });

    expect(summary.skipped).toEqual([
      { orderId: 'order-1', reason: 'unhealable_gateway' },
    ]);
    expect(mocks.finalizeOrderGatewayPayment).not.toHaveBeenCalled();
  });

  it('retires completed transactions without a gateway reference', async () => {
    const missingReferenceRow = {
      ...failedRow,
      transactions: {
        ...failedRow.transactions,
        gateway_reference: null,
        metadata: null,
      },
    };
    const supabase = buildSupabase({ data: [missingReferenceRow] });
    mocks.retireTerminalSideEffectDrain.mockResolvedValue(true);

    const summary = await drainFailedPaidOrderSideEffects({
      finalizePayment: mocks.finalizeOrderGatewayPayment,
      fileWedgeReview: vi.fn(),
      scheduleAfter,
      supabase,
    });

    expect(mocks.retireTerminalSideEffectDrain).toHaveBeenCalledWith(
      expect.objectContaining({
        resolution: 'missing_gateway_reference',
        transaction: expect.objectContaining({ gateway_reference: null }),
      })
    );
    expect(summary.skipped).toEqual([
      { orderId: 'order-1', reason: 'missing_gateway_reference' },
    ]);
  });

  it('drains stale claimed rows a crashed worker left behind', async () => {
    // First query (failed rows) returns nothing; second (stale claims)
    // returns the abandoned row.
    const results = [
      { data: [], error: null },
      { data: [failedRow], error: null },
    ];
    const from = vi.fn(() => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'not', 'is', 'lt', 'in']) {
        builder[method] = vi.fn().mockReturnValue(builder);
      }
      builder.limit = vi
        .fn()
        .mockResolvedValue(results.shift() ?? { data: [], error: null });
      return builder;
    });
    const supabase = { from } as unknown as SupabaseClient;
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    const summary = await drainFailedPaidOrderSideEffects({
      finalizePayment: mocks.finalizeOrderGatewayPayment,
      fileWedgeReview: vi.fn(),
      scheduleAfter,
      supabase,
    });

    expect(summary.drained).toEqual([{ orderId: 'order-1' }]);
    expect(mocks.finalizeOrderGatewayPayment).toHaveBeenCalledTimes(1);
  });

  it('records finalizer failures without aborting the run', async () => {
    const supabase = buildSupabase({ data: [failedRow] });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      error: 'x',
      kind: 'order_fetch_failed',
    });

    const summary = await drainFailedPaidOrderSideEffects({
      finalizePayment: mocks.finalizeOrderGatewayPayment,
      fileWedgeReview: vi.fn(),
      scheduleAfter,
      supabase,
    });

    expect(summary.failed).toEqual([
      { orderId: 'order-1', reason: 'order_fetch_failed' },
    ]);
  });

  it('stops starting orders at the pass deadline', async () => {
    const supabase = buildSupabase({ data: [failedRow] });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_270_000);

    try {
      const summary = await drainFailedPaidOrderSideEffects({
        finalizePayment: mocks.finalizeOrderGatewayPayment,
        fileWedgeReview: vi.fn(),
        deadlineMs: 1_270_000,
        scheduleAfter,
        supabase,
      });

      expect(summary.drained).toEqual([]);
      expect(summary.failed).toEqual([]);
      expect(mocks.finalizeOrderGatewayPayment).not.toHaveBeenCalled();
      expect(mocks.verifyGatewayCharge).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });
});
