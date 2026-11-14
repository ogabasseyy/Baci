// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { startBuildLeaseHeartbeat } from './build-lease-heartbeat';

afterEach(() => vi.useRealTimers());

it('renews without overlapping, fails closed after a lost lease, and stops', async () => {
  vi.useFakeTimers();
  const renew = vi
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  const lease = startBuildLeaseHeartbeat(renew, 1000);
  await vi.advanceTimersByTimeAsync(1000);
  expect(renew).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  await expect(lease.assertHeld()).rejects.toThrow('BUILD_LEASE_LOST');
  await lease.stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(renew).toHaveBeenCalledTimes(2);
});

it('checks the lease immediately before commit and treats errors as lost', async () => {
  vi.useFakeTimers();
  const lease = startBuildLeaseHeartbeat(
    vi.fn().mockRejectedValue(Error('private error')),
    1000
  );
  await expect(lease.assertHeld()).rejects.toThrow('BUILD_LEASE_LOST');
  await lease.stop();
});

it('fails closed and allows shutdown when a lease renewal never returns', async () => {
  vi.useFakeTimers();
  let release: ((held: boolean) => void) | undefined;
  const renew = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve;
      })
  );
  const lease = startBuildLeaseHeartbeat(renew, 1000, 100);
  const check = expect(lease.assertHeld()).rejects.toThrow('BUILD_LEASE_LOST');
  await vi.advanceTimersByTimeAsync(100);
  await check;
  release?.(true);
  await expect(lease.assertHeld()).rejects.toThrow('BUILD_LEASE_LOST');
  await lease.stop();
  expect(renew).toHaveBeenCalledTimes(1);
});
