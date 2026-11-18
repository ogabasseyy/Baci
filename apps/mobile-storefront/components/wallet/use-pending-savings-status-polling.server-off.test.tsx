import { act, renderHook } from '@testing-library/react-native';
import type { SavingsStatusCheckResult } from './use-pending-savings-status-check';
import {
  STATUS_POLL_WINDOW_MS,
  usePendingSavingsStatusPolling,
} from './use-pending-savings-status-polling';

// With PiggyVest off on the server every read comes back unavailable: the
// polling keeps to its schedule, stops at the window and only ever calls the
// status check (it has no way to start a payment).
describe('pending status polling with the server off', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps to the schedule, then stops after the window', async () => {
    const check = jest.fn(
      async (): Promise<SavingsStatusCheckResult> => 'unavailable'
    );
    renderHook(() => usePendingSavingsStatusPolling('operation', check));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(35_000);
    });
    expect(check).toHaveBeenCalledTimes(3);
    for (let minute = 0; minute < 10; minute += 1) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
    }
    const total = check.mock.calls.length;
    expect(total).toBeLessThanOrEqual(
      Math.ceil(STATUS_POLL_WINDOW_MS / 30_000) + 3
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(STATUS_POLL_WINDOW_MS);
    });
    expect(check).toHaveBeenCalledTimes(total);
  });

  it('never runs without a stored operation', async () => {
    const check = jest.fn(
      async (): Promise<SavingsStatusCheckResult> => 'unavailable'
    );
    renderHook(() => usePendingSavingsStatusPolling(null, check));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(STATUS_POLL_WINDOW_MS);
    });
    expect(check).not.toHaveBeenCalled();
  });
});
