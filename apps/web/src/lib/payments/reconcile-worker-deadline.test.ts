import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPPED_RECONCILE_PHASE_MS } from '../orders/cancellation-drain-deadline';
import { cancellationSideEffectDrainLimit } from '../orders/cancellation-side-effect-drain-limit';
import {
  NO_RECONCILE_DEADLINE,
  reconcileWorkerDeadlineMs,
  shouldYieldReconcileWorker,
} from './reconcile-worker-deadline';

describe('reconcileWorkerDeadlineMs', () => {
  it('bounds the reconciliation phase so later drains keep their share', () => {
    // Two provider-timeout intervals of slack: the recovery-watch
    // sweep runs two SEQUENTIAL 8s reads per redriven row.
    expect(reconcileWorkerDeadlineMs(1_000_000)).toBe(1_044_000);
  });

  it('stops row starts early enough that the worst-case overrun keeps the reserved step', () => {
    // The last started row may run two sequential 8s provider
    // timeouts past the row-start gate: at that worst-case phase end
    // the side-effect drain must still admit its sole reserved step.
    const rowStartDeadline = reconcileWorkerDeadlineMs(1_000_000);
    const worstCaseElapsed = rowStartDeadline + 16_000 - 1_000_000;
    expect(worstCaseElapsed).toBe(60_000);
    expect(
      cancellationSideEffectDrainLimit(worstCaseElapsed)
    ).toBeGreaterThanOrEqual(1);
  });

  it('caps the phase when verification pends without starving the serial drain', () => {
    // The capped phase ends with exactly the 76s preflight budget
    // before the phase end; the row-start gate sits the same two
    // provider timeouts inside it, and the worst-case overrun
    // still admits the first serial steps.
    expect(
      reconcileWorkerDeadlineMs(1_000_000, CAPPED_RECONCILE_PHASE_MS)
    ).toBe(1_028_000);
    const worstCaseElapsed =
      reconcileWorkerDeadlineMs(1_000_000, CAPPED_RECONCILE_PHASE_MS) +
      16_000 -
      1_000_000;
    expect(worstCaseElapsed).toBe(CAPPED_RECONCILE_PHASE_MS);
    expect(
      cancellationSideEffectDrainLimit(worstCaseElapsed)
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('shouldYieldReconcileWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('yields only once the deadline passes, never for the no-deadline sentinel', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(shouldYieldReconcileWorker(1_000_001)).toBe(false);
    expect(shouldYieldReconcileWorker(1_000_000)).toBe(true);
    expect(shouldYieldReconcileWorker(NO_RECONCILE_DEADLINE)).toBe(false);
  });
});
