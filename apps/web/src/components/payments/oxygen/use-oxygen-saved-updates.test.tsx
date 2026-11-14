import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useOxygenSavedUpdates } from './use-oxygen-saved-updates';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('reads saved callback updates after provider polling stops, then stops when the address advances', async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValue(undefined);
  const { rerender } = renderHook(
    ({ waiting }) => useOxygenSavedUpdates('workflow', waiting, false, read),
    { initialProps: { waiting: true } }
  );
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(read).toHaveBeenCalledTimes(1);
  rerender({ waiting: false });
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(read).toHaveBeenCalledTimes(1);
});
it('bounds background reads but checks again when the customer returns after manual review', async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValue(undefined);
  renderHook(() => useOxygenSavedUpdates('workflow', true, false, read));
  await act(() => vi.advanceTimersByTimeAsync(600_000));
  expect(read).toHaveBeenCalledTimes(20);
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(read).toHaveBeenCalledTimes(21);
});
it('does not overlap reads or read while hidden, busy or unmounted', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const read = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const hidden = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('hidden');
  const { rerender, unmount } = renderHook(
    ({ busy }) => useOxygenSavedUpdates('workflow', true, busy, read),
    { initialProps: { busy: false } }
  );
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(read).not.toHaveBeenCalled();
  hidden.mockReturnValue('visible');
  rerender({ busy: true });
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(read).not.toHaveBeenCalled();
  rerender({ busy: false });
  await act(async () => window.dispatchEvent(new Event('focus')));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(read).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => finish());
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(read).toHaveBeenCalledTimes(1);
});
it('keeps saved progress after a read error and cleans up return listeners', async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockRejectedValue(new Error('offline'));
  const { unmount } = renderHook(() =>
    useOxygenSavedUpdates('workflow', true, false, read)
  );
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(read).toHaveBeenCalledTimes(1);
  unmount();
  window.dispatchEvent(new Event('focus'));
  expect(read).toHaveBeenCalledTimes(1);
});
