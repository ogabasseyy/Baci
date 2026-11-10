import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useOxygenConfirmationUpdates } from './use-oxygen-confirmation-updates';

afterEach(() => vi.useRealTimers());
it('bounds automatic status reads and stops when the dialog is closed', async () => {
  vi.useFakeTimers();
  const refresh = vi.fn().mockResolvedValue(undefined);
  const view = renderHook(
    ({ busy, active }) =>
      useOxygenConfirmationUpdates('workflow', true, active, busy, refresh),
    { initialProps: { busy: false, active: true } }
  );
  for (let n = 0; n < 4; n += 1) {
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    view.rerender({ busy: true, active: true });
    view.rerender({ busy: false, active: true });
  }
  expect(refresh).toHaveBeenCalledTimes(4);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(refresh).toHaveBeenCalledTimes(4);
  view.unmount();
  const closed = renderHook(() =>
    useOxygenConfirmationUpdates('another', true, false, false, refresh)
  );
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(refresh).toHaveBeenCalledTimes(4);
  closed.unmount();
});
