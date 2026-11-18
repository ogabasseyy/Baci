import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEADLINE_PASSED, withinDeadline } from './within-deadline';

describe('withinDeadline', () => {
  afterEach(() => vi.useRealTimers());

  it('returns the result of work that finishes in time', async () => {
    vi.useFakeTimers();

    await expect(withinDeadline(Promise.resolve('done'), 100)).resolves.toBe(
      'done'
    );
    // The deadline timer is cleared once the work has settled.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up once the deadline has passed', async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => undefined);

    const outcome = withinDeadline(never, 100);
    await vi.advanceTimersByTimeAsync(99);
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toBe(DEADLINE_PASSED);
  });

  it('passes on a failure of the work itself', async () => {
    await expect(
      withinDeadline(Promise.reject(new Error('store down')), 100)
    ).rejects.toThrow('store down');
  });
});
