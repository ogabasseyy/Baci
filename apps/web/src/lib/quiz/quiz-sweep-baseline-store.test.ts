import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRedis: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({
  getRedis: mocks.getRedis,
}));

import {
  loadQuizSweepBaseline,
  resetQuizSweepBaselineForTests,
  saveQuizSweepBaseline,
} from './quiz-sweep-baseline-store';

function makeWatermarks(floor = '2026-09-01T00:00:00.000Z') {
  return {
    events: {
      status: 'ok' as const,
      floor,
      boundarySnapshots: new Map([['evt-1', '{"status":"ended"}']]),
    },
    reservations: {
      status: 'empty' as const,
      floor: '1970-01-01T00:00:00.000Z',
      boundarySnapshots: new Map<string, string>(),
    },
    awards: {
      status: 'ok' as const,
      floor,
      boundarySnapshots: new Map([['awd-1', '{"status":"pending"}']]),
    },
    hasProbeFailure: false,
  };
}

describe('quiz-sweep-baseline-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQuizSweepBaselineForTests();
    mocks.getRedis.mockReturnValue(null);
  });

  it('uses in-memory baseline when Redis is not configured', async () => {
    expect(await loadQuizSweepBaseline()).toEqual({
      baseline: null,
      requiresColdStartSweep: false,
    });

    const baseline = {
      watermarks: makeWatermarks(),
      hasPendingRecoverySweep: false,
    };
    await saveQuizSweepBaseline(baseline);

    expect(await loadQuizSweepBaseline()).toEqual({
      baseline,
      requiresColdStartSweep: false,
    });
  });

  it('persists and restores baseline via Redis across cold starts', async () => {
    let storedValue: unknown = null;
    const redis = {
      get: vi.fn(async () => storedValue),
      set: vi.fn(async (_key: string, value: unknown) => {
        storedValue = JSON.stringify(value);
      }),
    };
    mocks.getRedis.mockReturnValue(redis);

    // Cold start with empty Redis key fails closed with requiresColdStartSweep: true
    expect(await loadQuizSweepBaseline()).toEqual({
      baseline: null,
      requiresColdStartSweep: true,
    });

    const baseline = {
      watermarks: makeWatermarks(),
      hasPendingRecoverySweep: false,
    };
    await saveQuizSweepBaseline(baseline);

    // Simulate fresh serverless isolate by clearing in-memory cache while Redis retains storedValue
    resetQuizSweepBaselineForTests();
    const loaded = await loadQuizSweepBaseline();
    expect(loaded.requiresColdStartSweep).toBe(false);
    expect(loaded.baseline).toEqual(baseline);
  });

  it('requires cold-start sweep when Redis read fails or returns malformed data', async () => {
    mocks.getRedis.mockReturnValue({
      get: vi.fn().mockRejectedValueOnce(new Error('redis down')),
      set: vi.fn(),
    });
    expect(await loadQuizSweepBaseline()).toEqual({
      baseline: null,
      requiresColdStartSweep: true,
    });

    mocks.getRedis.mockReturnValue({
      get: vi.fn().mockResolvedValueOnce({ bad: 'shape' }),
      set: vi.fn(),
    });
    expect(await loadQuizSweepBaseline()).toEqual({
      baseline: null,
      requiresColdStartSweep: true,
    });
  });
});
