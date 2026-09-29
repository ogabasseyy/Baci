import { beforeEach, describe, expect, it, vi } from 'vitest';

const finalize = vi.hoisted(() => vi.fn());
vi.mock('./finalize-order-gateway-payment', () => ({
  finalizeOrderGatewayPayment: finalize,
}));

import { finalizePartiallyPaidAbandonedAttempt } from './finalize-partially-paid-abandoned-attempt';

const attempt = {
  amount: 100,
  gateway_reference: 'BAC-OLD',
  id: 'attempt-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
  platform_fee: 2,
  status: 'pending',
} as const;

function admittingClient(admitted: unknown[] | null, error: unknown = null) {
  const select = vi.fn().mockResolvedValue({ data: admitted, error });
  const chain = { eq: vi.fn(), select };
  chain.eq.mockReturnValue(chain);
  return { from: vi.fn(() => ({ update: vi.fn(() => chain) })), select };
}

function harness() {
  return {
    finalizePayment: finalize,
    hold: vi.fn().mockResolvedValue(undefined),
    scheduleAfter: vi.fn(),
    summary: {
      completed: [] as string[],
      failed: false,
      reviewsFiled: [] as string[],
    },
    supabase: {} as never,
  };
}

describe('finalizePartiallyPaidAbandonedAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records a completed order without claiming the transaction flip', async () => {
    const h = harness();
    finalize.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt,
      providerData: { reference: 'BAC-OLD' },
    });

    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'cron:reconcile-gateway-paid-orders',
        gateway: 'paystack',
        orderId: 'order-1',
        reference: 'BAC-OLD',
        wonTransactionFlip: false,
      })
    );
    expect(h.summary.completed).toEqual(['attempt-1']);
    expect(h.hold).not.toHaveBeenCalled();
  });

  it('records a review when the finalizer reports a cancelled order', async () => {
    const h = harness();
    finalize.mockResolvedValue({ kind: 'order_cancelled' });

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt,
      providerData: {},
    });

    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
    expect(h.summary.failed).toBe(false);
  });

  it('holds quietly when the row moved concurrently', async () => {
    const h = harness();
    finalize.mockResolvedValue({
      error: { error_code: 'TRANSACTION_IN_UNEXPECTED_STATE' },
      kind: 'completion_failed',
    });

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt,
      providerData: {},
    });

    expect(h.hold).toHaveBeenCalledWith('changed_concurrently');
    expect(h.summary.failed).toBe(false);
  });

  it('fails the sweep when order completion errors', async () => {
    const h = harness();
    finalize.mockResolvedValue({
      error: new Error('completion unavailable'),
      kind: 'completion_failed',
    });

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt,
      providerData: {},
    });

    expect(h.summary.failed).toBe(true);
    expect(h.hold).toHaveBeenCalledWith('completion_failed');
  });

  it('admits a processing attempt to pending before finalizing it', async () => {
    const h = harness();
    const { from, select } = admittingClient([{ id: 'attempt-1' }]);
    finalize.mockResolvedValue({ kind: 'completed' });

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt: { ...attempt, status: 'processing' },
      providerData: {},
      supabase: { from } as never,
    });

    expect(select).toHaveBeenCalledWith('id');
    expect(finalize).toHaveBeenCalled();
    expect(h.summary.completed).toEqual(['attempt-1']);
    expect(h.hold).not.toHaveBeenCalled();
  });

  it('holds a processing attempt lost to a concurrent completion', async () => {
    const h = harness();
    const { from } = admittingClient([]);
    finalize.mockResolvedValue({ kind: 'completed' });

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt: { ...attempt, status: 'processing' },
      providerData: {},
      supabase: { from } as never,
    });

    expect(finalize).not.toHaveBeenCalled();
    expect(h.hold).toHaveBeenCalledWith('changed_concurrently');
    expect(h.summary.failed).toBe(false);
  });

  it('declines to start finalize without sufficient reserve', async () => {
    const h = harness();
    finalize.mockResolvedValue({ kind: 'completed' });

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt,
      deadlineMs: Date.now() + 10_000,
      providerData: {},
    });

    // Starting finalize 10s before the pass deadline would spend the
    // paid-email retry budget past it and starve the later passes. The
    // held row retries on the next sweep without failing it.
    expect(finalize).not.toHaveBeenCalled();
    expect(h.hold).toHaveBeenCalledWith('finalize_budget_exhausted');
    expect(h.summary.failed).toBe(false);
    expect(h.summary.completed).toEqual([]);
  });

  it('forwards the remaining deadline to the finalizer', async () => {
    const h = harness();
    finalize.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt,
      deadlineMs: Date.now() + 60_000,
      providerData: {},
    });

    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(h.summary.completed).toEqual(['attempt-1']);
  });

  it('holds quietly when finalize overruns the pass deadline', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_100_000);
      const h = harness();
      finalize.mockReturnValue(
        new Promise(() => {
          // Never settles: the race must stop waiting at the deadline
          // instead of reaching the route limit with claimed work in flight.
        })
      );

      const pending = finalizePartiallyPaidAbandonedAttempt({
        ...h,
        attempt,
        deadlineMs: 1_121_000,
        providerData: {},
      });
      await vi.advanceTimersByTimeAsync(11_000);
      await pending;

      expect(h.hold).toHaveBeenCalledWith('finalize_deadline_exceeded');
      expect(h.summary.failed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails the sweep when admitting a processing attempt errors', async () => {
    const h = harness();
    const { from } = admittingClient(null, new Error('database unavailable'));

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt: { ...attempt, status: 'processing' },
      providerData: {},
      supabase: { from } as never,
    });

    expect(finalize).not.toHaveBeenCalled();
    expect(h.hold).toHaveBeenCalledWith('changed_concurrently');
    expect(h.summary.failed).toBe(true);
  });
});
