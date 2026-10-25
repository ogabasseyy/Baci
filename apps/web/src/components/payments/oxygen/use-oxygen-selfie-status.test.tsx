import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOxygenSelfieStatus } from './use-oxygen-selfie-status';

const fetchStatus = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: fetchStatus }));
beforeEach(() => {
  vi.useFakeTimers();
  fetchStatus.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const response = (confirmed: boolean) =>
  new Response(
    JSON.stringify({ confirmed, checkedAt: '2026-10-25T21:00:00Z' })
  );
it('waits for provider DONE and only then completes once', async () => {
  const done = vi.fn();
  fetchStatus
    .mockResolvedValueOnce(response(false))
    .mockResolvedValueOnce(response(true));
  renderHook(() => useOxygenSelfieStatus('workflow', done));
  expect(done).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(done).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(done).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(fetchStatus).toHaveBeenCalledTimes(2);
});
it('bounds errors and allows an explicit status-only retry', async () => {
  fetchStatus.mockRejectedValue(new Error('offline'));
  const done = vi.fn();
  const view = renderHook(() => useOxygenSelfieStatus('workflow', done));
  await act(() => vi.advanceTimersByTimeAsync(15_000 * 15));
  expect(view.result.current.paused).toBe(true);
  expect(fetchStatus).toHaveBeenCalledTimes(15);
  expect(done).not.toHaveBeenCalled();
  fetchStatus.mockResolvedValue(response(true));
  act(() => view.result.current.retry());
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(done).toHaveBeenCalledOnce();
});
it('stops reads when the selfie is closed, and ignores late confirmation', async () => {
  let resolve: (response: Response) => void = () => {
    throw new Error('not started');
  };
  fetchStatus.mockReturnValue(
    new Promise<Response>((r) => {
      resolve = r;
    })
  );
  const done = vi.fn();
  const view = renderHook(() => useOxygenSelfieStatus('workflow', done));
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  view.unmount();
  await act(async () => {
    resolve(response(true));
  });
  expect(done).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(fetchStatus).toHaveBeenCalledOnce();
});
