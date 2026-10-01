import { describe, expect, it } from 'vitest';
import { runWithStabilityGate } from './run-with-stability-gate';

describe('runWithStabilityGate', () => {
  it('awaits three complete runs by default without sleeps', async () => {
    const iterations: number[] = [];

    const results = await runWithStabilityGate(async (iteration) => {
      iterations.push(iteration);
      return `pass-${iteration}`;
    });

    expect(iterations).toEqual([1, 2, 3]);
    expect(results).toEqual(['pass-1', 'pass-2', 'pass-3']);
  });

  it('reports the failing iteration and rejects unsafe repeat counts', async () => {
    await expect(
      runWithStabilityGate(async (iteration) => {
        if (iteration === 2) throw new Error('screen did not become ready');
        return iteration;
      })
    ).rejects.toThrow('iteration 2: screen did not become ready');

    await expect(
      runWithStabilityGate(() => true, { repeats: 1 })
    ).rejects.toThrow('greater than one');
  });
});
