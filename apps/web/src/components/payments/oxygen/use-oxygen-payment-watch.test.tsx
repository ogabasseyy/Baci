import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useOxygenPaymentWatch } from './use-oxygen-payment-watch';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('refreshes saved callback results and bounds status-only fallback checks', async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValue(undefined);
  const check = vi.fn().mockResolvedValue(undefined);
  const { result, rerender } = renderHook(
    ({ complete }) => useOxygenPaymentWatch(true, complete, read, check),
    { initialProps: { complete: false } }
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(read).toHaveBeenCalledTimes(17);
  expect(check).toHaveBeenCalledTimes(3);
  expect(result.current).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(check).toHaveBeenCalledTimes(3);
  rerender({ complete: true });
  expect(vi.getTimerCount()).toBe(0);
});
it('does not poll before payment and cancels timers after confirmation or unmount', async () => {
  vi.useFakeTimers();
  const read = vi.fn();
  const check = vi.fn();
  const { rerender, unmount } = renderHook(
    ({ active, complete }) =>
      useOxygenPaymentWatch(active, complete, read, check),
    { initialProps: { active: false, complete: false } }
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(read).not.toHaveBeenCalled();
  rerender({ active: true, complete: false });
  rerender({ active: true, complete: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(read).not.toHaveBeenCalled();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
