import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import type { SavingsStatusCheckResult } from './use-pending-savings-status-check';
import {
  STATUS_POLL_WINDOW_MS,
  statusPollDelay,
  usePendingSavingsStatusPolling,
} from './use-pending-savings-status-polling';

let appStateListener: ((state: AppStateStatus) => void) | undefined;
const remove = jest.fn();
beforeEach(() => {
  jest.useFakeTimers();
  appStateListener = undefined;
  remove.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void;
    return { remove } as never;
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** Lets the timer fire and the check's promise settle. */
async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function poll(
  check: jest.Mock<Promise<SavingsStatusCheckResult>, []>,
  operationId: string | null = 'op-1'
) {
  return renderHook(
    ({ id }: { id: string | null }) =>
      usePendingSavingsStatusPolling(id, check),
    { initialProps: { id: operationId } }
  );
}

it('backs off 5 s, 10 s, 20 s, then every 30 s', () => {
  expect([0, 1, 2, 3, 4, 9].map(statusPollDelay)).toEqual([
    5000, 10000, 20000, 30000, 30000, 30000,
  ]);
});

it('keeps checking past 30 s while the contribution stays pending', async () => {
  const check = jest.fn(
    async (): Promise<SavingsStatusCheckResult> => 'pending'
  );
  poll(check);
  await advance(4999);
  expect(check).not.toHaveBeenCalled();
  await advance(1); // 5 s
  await advance(10_000); // 15 s
  await advance(20_000); // 35 s: past the old card's 30 s limit
  expect(check).toHaveBeenCalledTimes(3);
  await advance(30_000); // 65 s
  await advance(30_000); // 95 s
  // 13:41:43 submit, 13:43:44 confirm: the ~2 minute settle is covered.
  await advance(30_000); // 125 s
  expect(check).toHaveBeenCalledTimes(6);
});

it('stops after the 5 minute window', async () => {
  const check = jest.fn(
    async (): Promise<SavingsStatusCheckResult> => 'pending'
  );
  poll(check);
  await advance(STATUS_POLL_WINDOW_MS + 60_000);
  const total = check.mock.calls.length;
  // 5 + 10 + 20 + 30 * 8 = 275 s: eleven reads, then quiet.
  expect(total).toBe(11);
  await advance(10 * 60_000);
  expect(check).toHaveBeenCalledTimes(total);
});

it.each([
  'confirmed',
  'cancelled',
  'not-found',
  'no-operation',
  'blocked',
] as const)('stops once a check answers %s', async (outcome) => {
  const check = jest.fn(async (): Promise<SavingsStatusCheckResult> => outcome);
  poll(check);
  await advance(5000);
  await advance(60_000);
  expect(check).toHaveBeenCalledTimes(1);
});

it('keeps going after a timed-out (unavailable) or rejected check', async () => {
  const check = jest
    .fn<Promise<SavingsStatusCheckResult>, []>()
    .mockResolvedValueOnce('unavailable')
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValue('confirmed');
  poll(check);
  await advance(5000);
  await advance(10_000);
  await advance(20_000);
  await advance(60_000);
  expect(check).toHaveBeenCalledTimes(3);
});

it('does nothing without a stored operation and stops when it is dropped', async () => {
  const check = jest.fn(
    async (): Promise<SavingsStatusCheckResult> => 'pending'
  );
  const view = poll(check, null);
  await advance(60_000);
  expect(check).not.toHaveBeenCalled();
  view.rerender({ id: 'op-1' });
  await advance(5000);
  expect(check).toHaveBeenCalledTimes(1);
  // Account change or settle: the controller passes null.
  view.rerender({ id: null });
  expect(remove).toHaveBeenCalled();
  await advance(5 * 60_000);
  expect(check).toHaveBeenCalledTimes(1);
});

it('stops on unmount', async () => {
  const check = jest.fn(
    async (): Promise<SavingsStatusCheckResult> => 'pending'
  );
  const view = poll(check);
  view.unmount();
  await advance(60_000);
  expect(check).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalled();
});

it('checks at once on return to the app and starts a fresh window', async () => {
  const check = jest.fn(
    async (): Promise<SavingsStatusCheckResult> => 'pending'
  );
  poll(check);
  await advance(STATUS_POLL_WINDOW_MS + 60_000);
  const before = check.mock.calls.length;
  await act(async () => appStateListener?.('background'));
  expect(check).toHaveBeenCalledTimes(before);
  await act(async () => appStateListener?.('active'));
  expect(check).toHaveBeenCalledTimes(before + 1);
  await advance(5000);
  expect(check).toHaveBeenCalledTimes(before + 2);
});

it('never schedules two chains when the app returns mid-wait', async () => {
  const check = jest.fn(
    async (): Promise<SavingsStatusCheckResult> => 'pending'
  );
  poll(check);
  await advance(3000);
  await act(async () => appStateListener?.('active'));
  expect(check).toHaveBeenCalledTimes(1);
  // Only the new chain's 5 s wait remains; the old 5 s timer was cleared.
  await advance(5000);
  expect(check).toHaveBeenCalledTimes(2);
  await advance(9999);
  expect(check).toHaveBeenCalledTimes(2);
  await advance(1);
  expect(check).toHaveBeenCalledTimes(3);
});
