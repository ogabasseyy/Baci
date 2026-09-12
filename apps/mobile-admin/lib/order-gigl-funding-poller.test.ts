import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderGiglFundingPoller } from './order-gigl-funding-poller';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('OrderGiglFundingPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-01T17:00:00.000Z');
  });

  it('never overlaps a slow tick with the next three-second tick', async () => {
    const first = deferred<'continue'>();
    const tick = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue('continue');
    const poller = new OrderGiglFundingPoller(tick);
    poller.start();

    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(9000);
    expect(tick).toHaveBeenCalledOnce();

    first.resolve('continue');
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(3000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('invalidates an old generation when polling restarts', async () => {
    const old = deferred<'continue'>();
    const tick = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue('continue');
    const poller = new OrderGiglFundingPoller(tick);
    poller.start();
    await vi.advanceTimersByTimeAsync(3000);

    poller.start();
    old.resolve('continue');
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(3000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('keeps the normal cadence bounded to twenty ticks', async () => {
    const tick = vi.fn().mockResolvedValue('continue');
    const poller = new OrderGiglFundingPoller(tick);
    poller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(20);
    await vi.advanceTimersByTimeAsync(6000);
    expect(tick).toHaveBeenCalledTimes(20);
  });
});
