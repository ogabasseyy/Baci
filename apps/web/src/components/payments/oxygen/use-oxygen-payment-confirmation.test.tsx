import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOxygenPaymentConfirmation } from './use-oxygen-payment-confirmation';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('reads saved status immediately and stops after twenty attempts', async () => {
  const read = vi.fn().mockResolvedValue(undefined);
  renderHook(() => useOxygenPaymentConfirmation(true, false, read));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000 * 25);
  });
  expect(read).toHaveBeenCalledTimes(20);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(read).toHaveBeenCalledTimes(20);
});
it('pauses while hidden or busy, resumes when visible, and cleans up', async () => {
  const read = vi.fn().mockResolvedValue(undefined);
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('hidden');
  const { rerender, unmount } = renderHook(
    ({ busy, enabled }) => useOxygenPaymentConfirmation(enabled, busy, read),
    { initialProps: { busy: false, enabled: true } }
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(read).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  rerender({ busy: true, enabled: true });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(read).not.toHaveBeenCalled();
  rerender({ busy: false, enabled: true });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(read).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(read).toHaveBeenCalledTimes(1);
});
it('does not read when inactive', async () => {
  const read = vi.fn();
  renderHook(() => useOxygenPaymentConfirmation(false, false, read));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(read).not.toHaveBeenCalled();
});
