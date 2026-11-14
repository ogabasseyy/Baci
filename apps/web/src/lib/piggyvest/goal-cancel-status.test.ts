import { beforeEach, expect, it, vi } from 'vitest';
import { publicStatus, readGoalCancelStatus } from './goal-cancel-status';

vi.mock('server-only', () => ({}));
const reconcile = vi.hoisted(() => vi.fn());
vi.mock('./goal-cancel-reconciliation', () => ({
  runGoalCancelReconciliation: reconcile,
}));
const operationId = '66666666-6666-4666-8666-666666666666';
function store(...states: (string | null)[]) {
  const readStatus = vi.fn();
  for (const state of states) readStatus.mockResolvedValueOnce(state);
  return {
    readStatus,
    cancelStaleReservation: vi.fn().mockResolvedValue(true),
  };
}
beforeEach(() => vi.clearAllMocks());

it('maps a reconciliation outcome to the public vocabulary', () => {
  expect(publicStatus({ status: 'cancelled' })).toEqual({ status: 'released' });
  expect(publicStatus({ status: 'pending', needsReview: true })).toEqual({
    status: 'needs_review',
  });
  expect(publicStatus({ status: 'confirmed' })).toEqual({
    status: 'confirmed',
  });
});

it.each([
  [null, 'not_found'],
  ['confirmed', 'confirmed'],
  ['reviewed', 'confirmed'],
  ['needs_review', 'needs_review'],
  ['issued', 'not_started'],
] as const)('reads recorded state %s as %s without asking PiggyVest', async (state, expected) => {
  expect(
    await readGoalCancelStatus(store(state), {}, 'token', operationId)
  ).toEqual({
    status: expected,
  });
  expect(reconcile).not.toHaveBeenCalled();
});

it('releases a stale reservation and reports the new state', async () => {
  const s = store('reserved', 'issued');
  expect(await readGoalCancelStatus(s, {}, 'token', operationId)).toEqual({
    status: 'not_started',
  });
  expect(s.cancelStaleReservation).toHaveBeenCalledWith(operationId);
});

it('asks PiggyVest about a dispatched attempt and never posts', async () => {
  reconcile.mockResolvedValue({ status: 'confirmed' });
  expect(
    await readGoalCancelStatus(store('dispatched'), {}, 'token', operationId)
  ).toEqual({
    status: 'confirmed',
  });
});

it('keeps a released attempt released when the late re-check fails', async () => {
  reconcile.mockRejectedValue(new Error('down'));
  expect(
    await readGoalCancelStatus(store('released'), {}, 'token', operationId)
  ).toEqual({
    status: 'released',
  });
});
