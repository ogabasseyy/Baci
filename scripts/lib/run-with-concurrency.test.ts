import { describe, expect, it } from 'vitest';
import { runWithConcurrency } from './run-with-concurrency';

describe('runWithConcurrency', () => {
  it('preserves result order regardless of completion order', async () => {
    const tasks = [30, 10, 20].map(
      (ms, i) => () =>
        new Promise<number>((resolve) => setTimeout(() => resolve(i), ms))
    );
    await expect(runWithConcurrency(tasks, 3)).resolves.toEqual([0, 1, 2]);
  });

  it('caps in-flight tasks at the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from(
      { length: 6 },
      () => async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
      }
    );
    await runWithConcurrency(tasks, 2);
    expect(peak).toBe(2);
  });
});
