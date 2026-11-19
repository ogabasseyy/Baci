import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetQuotaCountersForTesting,
  incrementMemoryCounter,
  incrementWindowCounter,
  MEMORY_COUNTER_MAX_ENTRIES,
  memoryCounters,
} from './request-quota-counter';

const mockGetRedis = vi.hoisted(() => vi.fn(() => null as unknown));

vi.mock('@/lib/redis', () => ({
  getRedis: mockGetRedis,
}));

afterEach(() => {
  vi.restoreAllMocks();
  mockGetRedis.mockReturnValue(null);
  __resetQuotaCountersForTesting();
});

describe('incrementMemoryCounter store bound', () => {
  it('admits new subjects after expired windows release capacity', () => {
    __resetQuotaCountersForTesting();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    for (let index = 0; index < MEMORY_COUNTER_MAX_ENTRIES; index++) {
      incrementMemoryCounter(`subject-${index}`, 60_000);
    }
    expect(incrementMemoryCounter('new-subject', 60_000).count).toBe(
      Number.POSITIVE_INFINITY
    );
    now.mockReturnValue(1_060_001);
    expect(incrementMemoryCounter('new-subject', 60_000).count).toBe(1);
    expect(memoryCounters.size).toBe(1);
  });
});

describe('incrementWindowCounter', () => {
  it('reports the Redis window expiry from PTTL, not now + window', async () => {
    mockGetRedis.mockReturnValue({
      createScript: () => ({ eval: async () => [3, 5_000] }),
    });
    const before = Date.now();
    const result = await incrementWindowCounter('quota:test', 3_600_000);
    const after = Date.now();
    expect(result).toMatchObject({ count: 3, degraded: false });
    expect(result.resetTime).toBeGreaterThanOrEqual(before + 5_000);
    expect(result.resetTime).toBeLessThanOrEqual(after + 5_000);
  });

  it('degrades on an impossible zero counter or scalar reply', async () => {
    mockGetRedis.mockReturnValue({
      createScript: () => ({ eval: async () => [0, 5_000] }),
    });
    await expect(
      incrementWindowCounter('quota:zero', 60_000)
    ).resolves.toMatchObject({ degraded: true });
    mockGetRedis.mockReturnValue({
      createScript: () => ({ eval: async () => 3 }),
    });
    await expect(
      incrementWindowCounter('quota:scalar', 60_000)
    ).resolves.toMatchObject({ degraded: true });
  });

  it('warns while degraded, throttled to once a minute', async () => {
    __resetQuotaCountersForTesting();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const now = vi.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000_000);
      await incrementWindowCounter('quota:warn', 60_000);
      const afterFirst = warn.mock.calls.length;
      expect(afterFirst).toBeGreaterThanOrEqual(1);

      // Still degraded a few seconds later: no second warning.
      now.mockReturnValue(1_030_000);
      await incrementWindowCounter('quota:warn', 60_000);
      expect(warn.mock.calls.length).toBe(afterFirst);

      // A minute later the degradation is reported again.
      now.mockReturnValue(1_061_000);
      await incrementWindowCounter('quota:warn', 60_000);
      expect(warn.mock.calls.length).toBe(afterFirst + 1);
    } finally {
      warn.mockRestore();
      now.mockRestore();
      __resetQuotaCountersForTesting();
    }
  });
});
