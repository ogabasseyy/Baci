import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBounded } from './refund-alert-lookup';

afterEach(() => vi.useRealTimers());

describe('runBounded', () => {
  it('returns the value when the lookup finishes in time', async () => {
    await expect(
      runBounded(Date.now() + 5_000, async () => 'ok')
    ).resolves.toEqual({ timedOut: false, value: 'ok' });
  });

  it('runs without a timer when there is no deadline', async () => {
    await expect(runBounded(undefined, async () => 1)).resolves.toEqual({
      timedOut: false,
      value: 1,
    });
  });

  it('times out without running when the deadline has passed', async () => {
    const run = vi.fn();
    await expect(runBounded(Date.now() - 1, run)).resolves.toEqual({
      timedOut: true,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('aborts the signal and reports a timeout when the lookup outlives the deadline', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const pending = runBounded(Date.now() + 1_000, (s) => {
      signal = s;
      return new Promise<never>(() => {});
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toEqual({ timedOut: true });
    expect(signal?.aborted).toBe(true);
  });

  it('does not abort a lookup that finished in time', async () => {
    let signal: AbortSignal | undefined;
    await runBounded(Date.now() + 1_000, async (s) => {
      signal = s;
      return 1;
    });
    expect(signal?.aborted).toBe(false);
  });
});
