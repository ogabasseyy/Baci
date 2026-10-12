import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drainFailedPaidOrderSideEffects } from '@/lib/payments/drain-failed-paid-order-side-effects';
import { drainFailedPaidOrderSideEffectsTestKit } from '@/lib/payments/drain-failed-paid-order-side-effects.test-helpers';
import { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail';

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

afterEach(() => {
  vi.useRealTimers();
});

describe('drainFailedPaidOrderSideEffects finalize deadline', () => {
  it('leaves the row for the next drain when too little finalize budget remains', async () => {
    const supabase = buildSupabase({ data: [failedRow] });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    const summary = await drainFailedPaidOrderSideEffects({
      deadlineMs: Date.now() + 19_000,
      finalizePayment: mocks.finalizeOrderGatewayPayment,
      fileWedgeReview: vi.fn(),
      scheduleAfter,
      supabase,
    });

    expect(mocks.finalizeOrderGatewayPayment).not.toHaveBeenCalled();
    expect(summary.drained).toEqual([]);
    expect(summary.failed).toEqual([]);
  });

  it('records finalize_deadline_exceeded and stops the drain when finalize overruns its deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const secondRow = { ...failedRow, order_id: 'order-2' };
    const supabase = buildSupabase({ data: [failedRow, secondRow] });
    mocks.finalizeOrderGatewayPayment.mockReturnValue(
      new Promise<never>(() => {})
    );

    // 200s clears the full 135s sender budget, so the hanging
    // finalize starts and the race records the overrun.
    const draining = drainFailedPaidOrderSideEffects({
      deadlineMs: 1_200_000,
      finalizePayment: mocks.finalizeOrderGatewayPayment,
      fileWedgeReview: vi.fn(),
      scheduleAfter,
      supabase,
    });
    // The deadline race fires 10s before the pass ends (200s budget -
    // 10s buffer), so the overrun is recorded with time left to report it.
    await vi.advanceTimersByTimeAsync(190_000);
    const summary = await draining;

    expect(mocks.finalizeOrderGatewayPayment).toHaveBeenCalledTimes(1);
    expect(summary.drained).toEqual([]);
    expect(summary.failed).toEqual([
      { orderId: 'order-1', reason: 'finalize_deadline_exceeded' },
    ]);
  });

  it('passes an abort signal to finalize that fires with the pass deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const supabase = buildSupabase({ data: [failedRow] });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    await drainFailedPaidOrderSideEffects({
      deadlineMs: 1_200_000,
      finalizePayment: mocks.finalizeOrderGatewayPayment,
      fileWedgeReview: vi.fn(),
      scheduleAfter,
      supabase,
    });

    // The signal shares the deadline race's 10s buffer (200s budget -
    // 10s): the orphaned finalize aborts with time left to persist its
    // own failure instead of delivering email after the caller gave up.
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenCalledWith(190_000);
    const signal = mocks.finalizeOrderGatewayPayment.mock.calls[0][0]
      .signal as AbortSignal;
    expect(signal).toBe(timeoutSpy.mock.results[0]?.value);
    expect(mocks.finalizeOrderGatewayPayment).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackDeadlineMs: 1_190_000 })
    );
  });

  it('leaves finalize unbound when the drain has no deadline', async () => {
    const supabase = buildSupabase({ data: [failedRow] });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    await drainFailedPaidOrderSideEffects({
      finalizePayment: mocks.finalizeOrderGatewayPayment,
      fileWedgeReview: vi.fn(),
      scheduleAfter,
      supabase,
    });

    expect(mocks.finalizeOrderGatewayPayment).toHaveBeenCalledWith(
      expect.objectContaining({ signal: undefined })
    );
  });

  it('still drains when finalize finishes inside the deadline', async () => {
    const supabase = buildSupabase({ data: [failedRow] });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    const summary = await drainFailedPaidOrderSideEffects({
      deadlineMs: Date.now() + 200_000,
      finalizePayment: mocks.finalizeOrderGatewayPayment,
      fileWedgeReview: vi.fn(),
      scheduleAfter,
      supabase,
    });

    expect(mocks.finalizeOrderGatewayPayment).toHaveBeenCalledTimes(1);
    expect(summary.drained).toEqual([{ orderId: 'order-1' }]);
    expect(summary.failed).toEqual([]);
  });

  it('stops the drain when only part of the single-attempt budget remains', async () => {
    const supabase = buildSupabase({ data: [failedRow] });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    // Just under the single-attempt budget: starting finalize would
    // abort mid-send into delivery_uncertain, marking the email
    // completed instead of leaving the row failed for the next drain.
    const summary = await drainFailedPaidOrderSideEffects({
      deadlineMs: Date.now() + zeptomailSendAdmissionBudgetMs(1) - 1000,
      finalizePayment: mocks.finalizeOrderGatewayPayment,
      fileWedgeReview: vi.fn(),
      scheduleAfter,
      supabase,
    });

    expect(mocks.finalizeOrderGatewayPayment).not.toHaveBeenCalled();
    expect(summary.drained).toEqual([]);
    expect(summary.failed).toEqual([]);
  });

  it('drains a 90s pass share with the single-attempt cap', async () => {
    const supabase = buildSupabase({ data: [failedRow] });
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    // The default four-attempt budget can never fit pass 2's 90s
    // incremental share; the capped send must, and the cap must reach
    // finalize so the send loop actually fits.
    expect(zeptomailSendAdmissionBudgetMs()).toBeGreaterThan(90_000);
    const summary = await drainFailedPaidOrderSideEffects({
      deadlineMs: Date.now() + 90_000,
      finalizePayment: mocks.finalizeOrderGatewayPayment,
      fileWedgeReview: vi.fn(),
      scheduleAfter,
      supabase,
    });

    expect(mocks.finalizeOrderGatewayPayment).toHaveBeenCalledWith(
      expect.objectContaining({ emailMaxAttemptsPerSender: 1 })
    );
    expect(summary.drained).toEqual([{ orderId: 'order-1' }]);
    expect(summary.failed).toEqual([]);
  });
});
