import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NO_RECONCILE_DEADLINE,
  reconcileWorkerDeadlineMs,
  shouldYieldReconcileWorker,
} from './reconcile-worker-deadline';

describe('reconcileWorkerDeadlineMs', () => {
  it('bounds the reconciliation phase so later drains keep their share', () => {
    expect(reconcileWorkerDeadlineMs(1_000_000)).toBe(1_060_000);
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
