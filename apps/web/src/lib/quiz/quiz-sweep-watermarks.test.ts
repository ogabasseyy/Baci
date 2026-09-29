import { describe, expect, it, vi } from 'vitest';

import { resolveQuizSweepWatermarks } from './quiz-sweep-watermarks';

describe('resolveQuizSweepWatermarks', () => {
  function probeClient(
    maxima: Partial<
      Record<
        'quiz_awards' | 'quiz_events' | 'quiz_prize_reservations',
        string | null
      >
    >
  ) {
    return {
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn(() => builder);
        builder.not = vi.fn(() => builder);
        builder.order = vi.fn(() => builder);
        builder.limit = vi.fn(() => {
          const max = maxima[table as keyof typeof maxima] ?? null;
          return Promise.resolve({
            data:
              max === null || max === undefined
                ? []
                : [
                    {
                      updated_at: max,
                      expired_at: max,
                    },
                  ],
            error: null,
          });
        });
        return builder;
      }),
    };
  }

  it('takes each floor from the database clock, not the worker clock', async () => {
    // Database behind the worker: rows the RPCs just wrote carry
    // timestamps older than worker-now. A worker-derived watermark would
    // silently skip them; the probed maxima keep them covered.
    const client = probeClient({
      quiz_events: '2026-09-01T00:00:00Z',
      quiz_prize_reservations: '2026-09-01T00:00:01Z',
      quiz_awards: '2026-09-01T00:00:02Z',
    });

    const watermarks = await resolveQuizSweepWatermarks(
      client as never,
      '2026-09-01T00:05:00Z'
    );

    expect(watermarks).toEqual({
      events: '2026-09-01T00:00:00Z',
      reservations: '2026-09-01T00:00:01Z',
      awards: '2026-09-01T00:00:02Z',
    });
  });

  it('falls back to an overlapped worker floor when probes fail or are empty', async () => {
    const failing = {
      from: vi.fn(() => {
        throw new Error('probe down');
      }),
    };

    const watermarks = await resolveQuizSweepWatermarks(
      failing as never,
      '2026-09-01T00:05:00Z'
    );

    // Worker start minus the 2-minute skew margin: bounded over-sweep
    // instead of a silent skip.
    expect(watermarks).toEqual({
      events: '2026-09-01T00:03:00.000Z',
      reservations: '2026-09-01T00:03:00.000Z',
      awards: '2026-09-01T00:03:00.000Z',
    });
  });

  it('falls back per table, keeping successful probes exact', async () => {
    const client = probeClient({
      quiz_events: '2026-09-01T00:00:00Z',
    });

    const watermarks = await resolveQuizSweepWatermarks(
      client as never,
      '2026-09-01T00:05:00Z'
    );

    expect(watermarks).toEqual({
      events: '2026-09-01T00:00:00Z',
      reservations: '2026-09-01T00:03:00.000Z',
      awards: '2026-09-01T00:03:00.000Z',
    });
  });
});
