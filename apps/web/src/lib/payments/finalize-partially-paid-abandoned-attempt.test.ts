import { beforeEach, describe, expect, it, vi } from 'vitest';

const finalize = vi.hoisted(() => vi.fn());
const fileDuplicate = vi.hoisted(() => vi.fn());
vi.mock('./finalize-order-gateway-payment', () => ({
  finalizeOrderGatewayPayment: finalize,
}));
vi.mock('./file-duplicate-payment-capture', () => ({
  fileDuplicatePaymentCapture: fileDuplicate,
}));

import { finalizePartiallyPaidAbandonedAttempt } from './finalize-partially-paid-abandoned-attempt';
import {
  admittingClient,
  finalizationAttempt as attempt,
  finalizationHarness,
} from './finalize-partially-paid-abandoned-attempt.test-helpers';

function harness() {
  return finalizationHarness(finalize);
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

  it('files a duplicate review when the order filled before the atomic flip', async () => {
    const h = harness();
    finalize.mockResolvedValue({
      capturedOnPaidOrder: true,
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });
    fileDuplicate.mockResolvedValue(true);

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt,
      providerData: {
        amount: 10000,
        currency: 'NGN',
        reference: 'BAC-OLD',
        status: 'success',
      },
    });

    // The partially-paid snapshot was stale: the atomic completion found
    // the order already paid, so this capture is extra money and owes a
    // duplicate-charge review instead of a completion record.
    expect(fileDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: {
          providerAmount: 10000,
          providerCurrency: 'NGN',
          providerReference: 'BAC-OLD',
          providerStatus: 'success',
        },
      })
    );
    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
    expect(h.summary.completed).toEqual([]);
    expect(h.summary.failed).toBe(false);
    expect(h.hold).not.toHaveBeenCalled();
  });

  it('fails the sweep when the late duplicate review cannot be filed', async () => {
    const h = harness();
    finalize.mockResolvedValue({
      capturedOnPaidOrder: true,
      kind: 'completed',
    });
    fileDuplicate.mockResolvedValue(false);

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt,
      providerData: {},
    });

    expect(h.summary.failed).toBe(true);
    expect(h.hold).toHaveBeenCalledWith('duplicate_capture_review_failed');
    expect(h.summary.reviewsFiled).toEqual([]);
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
