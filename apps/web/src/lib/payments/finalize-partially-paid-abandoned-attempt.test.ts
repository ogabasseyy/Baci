import { beforeEach, describe, expect, it, vi } from 'vitest';

const finalize = vi.hoisted(() => vi.fn());
const fileDuplicate = vi.hoisted(() => vi.fn());
const fileDuplicateFallback = vi.hoisted(() => vi.fn());
const gatePartial = vi.hoisted(() => vi.fn());
vi.mock('./finalize-order-gateway-payment', () => ({
  finalizeOrderGatewayPayment: finalize,
}));
vi.mock('./file-duplicate-payment-capture', () => ({
  fileDuplicatePaymentCapture: fileDuplicate,
}));
vi.mock('./file-duplicate-capture-fallback-review', () => ({
  fileDuplicateCaptureFallbackReview: fileDuplicateFallback,
}));
vi.mock('./gate-partially-paid-abandoned-capture', () => ({
  gatePartiallyPaidAbandonedCapture: gatePartial,
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
    gatePartial.mockResolvedValue('proceed');
  });

  it('skips the finalizer when the balance gate handles the capture', async () => {
    const h = harness();
    gatePartial.mockResolvedValue('done');
    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt,
      providerData: {},
    });
    expect(finalize).not.toHaveBeenCalled();
  });

  it('records a completed order with the pending-capture flip preserved', async () => {
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

    // The pending row is fresh-capture evidence: forcing false would
    // let a concurrently-paid order with no outbox rows misclassify
    // the capture as a legacy replay, skipping settlement and the
    // duplicate review.
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'cron:reconcile-gateway-paid-orders',
        gateway: 'paystack',
        orderId: 'order-1',
        reference: 'BAC-OLD',
        wonTransactionFlip: true,
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

  it('holds when only part of the single-attempt sender budget remains', async () => {
    const h = harness();
    finalize.mockResolvedValue({ kind: 'completed' });

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt,
      deadlineMs: Date.now() + 30_000,
      providerData: {},
    });

    // 30s clears the old 20s check but not the 48s single-attempt
    // sender budget: starting finalize would abort mid-send into a
    // completed-unknown email instead of holding for the next sweep.
    expect(finalize).not.toHaveBeenCalled();
    expect(h.hold).toHaveBeenCalledWith('finalize_budget_exhausted');
    expect(h.summary.failed).toBe(false);
  });

  it('forwards the remaining deadline to the finalizer', async () => {
    const h = harness();
    finalize.mockResolvedValue({
      healed: false,
      kind: 'completed',
      orderNumber: 'ORD-1',
    });
    const deadlineMs = Date.now() + 200_000;

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt,
      deadlineMs,
      providerData: {},
    });

    // Pass 0 caps the send at one attempt per sender so its 90s
    // share fits the 48s budget; the platform-sender fallback shares
    // the signal's 10s buffer.
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        emailMaxAttemptsPerSender: 1,
        fallbackDeadlineMs: deadlineMs - 10_000,
        signal: expect.any(AbortSignal),
      })
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

      // 150s clears the full 135s sender budget, so the
      // never-settling finalize is what the race must stop waiting for.
      const pending = finalizePartiallyPaidAbandonedAttempt({
        ...h,
        attempt,
        deadlineMs: 1_250_000,
        providerData: {},
      });
      await vi.advanceTimersByTimeAsync(151_000);
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
        id: 555666777,
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
          gateway: 'paystack',
          providerAmount: 10000,
          providerCurrency: 'NGN',
          providerReference: '555666777',
          providerStatus: 'success',
        },
      })
    );
    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
    expect(h.summary.completed).toEqual([]);
    expect(h.summary.failed).toBe(false);
    expect(h.hold).not.toHaveBeenCalled();
  });

  it('persists the fallback review when the late duplicate filing fails', async () => {
    const h = harness();
    finalize.mockResolvedValue({
      capturedOnPaidOrder: true,
      kind: 'completed',
    });
    fileDuplicate.mockResolvedValue(false);
    fileDuplicateFallback.mockResolvedValue(true);

    await finalizePartiallyPaidAbandonedAttempt({
      ...h,
      attempt,
      providerData: {},
    });

    // The row already completed, so the status-guarded hold would
    // persist nothing: the direct fallback insert keeps the evidence.
    expect(fileDuplicateFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: expect.objectContaining({ id: 'attempt-1' }),
      })
    );
    expect(h.summary.reviewsFiled).toEqual(['attempt-1']);
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
    fileDuplicateFallback.mockResolvedValue(false);

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
