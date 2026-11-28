import { describe, expect, it } from 'vitest';
import { runGenerationChurnBenchmarkAsync } from './generation-churn-sim';

describe('generation-churn-sim', () => {
  it('preserves high catalog cache hit ratio under split-availability at 60 inventory writes/min', async () => {
    const single = await runGenerationChurnBenchmarkAsync({
      inventoryWritesPerMinute: 60,
      strategy: 'single-generation',
      productCount: 120,
    });
    const split = await runGenerationChurnBenchmarkAsync({
      inventoryWritesPerMinute: 60,
      strategy: 'split-availability',
      productCount: 120,
    });
    expect(split.catalogCacheHitRatio).toBeGreaterThan(94);
    expect(single.catalogCacheHitRatio).toBeLessThan(65);
  });
});
