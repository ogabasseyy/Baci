import { describe, expect, it, vi } from 'vitest';

import {
  resolveQuizSweepWatermarks,
  serializeBoundaryRowState,
} from './quiz-sweep-watermarks';

describe('resolveQuizSweepWatermarks', () => {
  function probeClient(
    maxima: Partial<
      Record<
        'quiz_awards' | 'quiz_events' | 'quiz_prize_reservations',
        string | null
      >
    >,
    options: {
      boundaryRows?: Partial<
        Record<
          'quiz_awards' | 'quiz_events' | 'quiz_prize_reservations',
          Record<string, unknown>[]
        >
      >;
      boundaryErrorTable?:
        | 'quiz_awards'
        | 'quiz_events'
        | 'quiz_prize_reservations';
      errorTable?: 'quiz_awards' | 'quiz_events' | 'quiz_prize_reservations';
    } = {}
  ) {
    const eqCalls: Array<{ column: string; table: string; value: unknown }> =
      [];
    return {
      eqCalls,
      from: vi.fn((table: string) => {
        let eqFilter: { column: string; value: unknown } | null = null;
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn(() => builder);
        builder.not = vi.fn(() => builder);
        builder.eq = vi.fn((column: string, value: unknown) => {
          eqFilter = { column, value };
          eqCalls.push({ column, table, value });
          return builder;
        });
        builder.order = vi.fn(() => builder);
        builder.range = vi.fn((from: number, to: number) => {
          if (options.boundaryErrorTable === table) {
            return Promise.resolve({
              data: null,
              error: { message: 'boundary snapshot failed' },
            });
          }
          const rows =
            options.boundaryRows?.[
              table as keyof typeof options.boundaryRows
            ] ?? [];
          const activeFilter = eqFilter;
          const filtered = activeFilter
            ? rows.filter(
                (row) => row[activeFilter.column] === activeFilter.value
              )
            : rows;
          return Promise.resolve({
            data: filtered.slice(from, to + 1),
            error: null,
          });
        });
        builder.limit = vi.fn(() => {
          if (options.errorTable === table) {
            return Promise.resolve({
              data: null,
              error: { message: 'probe failed' },
            });
          }
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

  it('takes each floor and boundary snapshot from the database clock', async () => {
    const boundaryEvent = {
      id: 'event-1',
      merchant_id: 'merchant-1',
      status: 'live',
      updated_at: '2026-09-01T00:00:00Z',
      settings: { prize_product_id: 'prod-1' },
    };
    const client = probeClient(
      {
        quiz_events: '2026-09-01T00:00:00Z',
        quiz_prize_reservations: '2026-09-01T00:00:01Z',
        quiz_awards: '2026-09-01T00:00:02Z',
      },
      {
        boundaryRows: {
          quiz_events: [boundaryEvent],
        },
      }
    );

    const watermarks = await resolveQuizSweepWatermarks(
      client as never,
      '2026-09-01T00:05:00Z'
    );

    expect(watermarks.hasProbeFailure).toBe(false);
    expect(client.eqCalls).toContainEqual({
      table: 'quiz_events',
      column: 'updated_at',
      value: '2026-09-01T00:00:00Z',
    });
    expect(watermarks.events.status).toBe('ok');
    expect(watermarks.events.floor).toBe('2026-09-01T00:00:00Z');
    expect(watermarks.events.boundarySnapshots.get('event-1')).toBe(
      serializeBoundaryRowState('quiz_events', boundaryEvent)
    );
    expect(watermarks.reservations).toEqual({
      status: 'ok',
      floor: '2026-09-01T00:00:01Z',
      boundarySnapshots: new Map(),
    });
    expect(watermarks.awards).toEqual({
      status: 'ok',
      floor: '2026-09-01T00:00:02Z',
      boundarySnapshots: new Map(),
    });
  });

  it('distinguishes empty tables from probe failures', async () => {
    const emptyClient = probeClient({});

    const watermarks = await resolveQuizSweepWatermarks(
      emptyClient as never,
      '2026-09-01T00:05:00Z'
    );

    expect(watermarks.hasProbeFailure).toBe(false);
    expect(watermarks.events).toEqual({
      status: 'empty',
      floor: '1970-01-01T00:00:00.000Z',
      boundarySnapshots: new Map(),
    });
    expect(watermarks.reservations.status).toBe('empty');
    expect(watermarks.awards.status).toBe('empty');
  });

  it('falls back to an overlapped worker floor and flags hasProbeFailure when probes throw', async () => {
    const failing = {
      from: vi.fn(() => {
        throw new Error('probe down');
      }),
    };

    const watermarks = await resolveQuizSweepWatermarks(
      failing as never,
      '2026-09-01T00:05:00Z'
    );

    expect(watermarks.hasProbeFailure).toBe(true);
    expect(watermarks.events).toEqual({
      status: 'error',
      floor: '2026-09-01T00:03:00.000Z',
      boundarySnapshots: new Map(),
    });
    expect(watermarks.reservations.status).toBe('error');
    expect(watermarks.awards.status).toBe('error');
  });

  it('flags hasProbeFailure per table when a max probe or boundary snapshot query errors', async () => {
    const client = probeClient(
      {
        quiz_events: '2026-09-01T00:00:00Z',
        quiz_prize_reservations: '2026-09-01T00:00:01Z',
      },
      {
        boundaryErrorTable: 'quiz_prize_reservations',
        errorTable: 'quiz_awards',
      }
    );

    const watermarks = await resolveQuizSweepWatermarks(
      client as never,
      '2026-09-01T00:05:00Z'
    );

    expect(watermarks.hasProbeFailure).toBe(true);
    expect(watermarks.events.status).toBe('ok');
    expect(watermarks.events.floor).toBe('2026-09-01T00:00:00Z');
    expect(watermarks.reservations).toEqual({
      status: 'error',
      floor: '2026-09-01T00:00:01Z',
      boundarySnapshots: new Map(),
    });
    expect(watermarks.awards).toEqual({
      status: 'error',
      floor: '2026-09-01T00:03:00.000Z',
      boundarySnapshots: new Map(),
    });
  });

  it('fails closed while keeping the DB floor when boundary snapshots exceed the page cap', async () => {
    const fivePages = Array.from({ length: 5000 }, (_, index) => ({
      id: `event-${index}`,
      updated_at: '2026-09-01T00:00:00Z',
    }));
    const client = probeClient(
      {
        quiz_events: '2026-09-01T00:00:00Z',
      },
      {
        boundaryRows: {
          quiz_events: fivePages,
        },
      }
    );

    const watermarks = await resolveQuizSweepWatermarks(
      client as never,
      '2026-09-01T00:05:00Z'
    );

    expect(watermarks.hasProbeFailure).toBe(true);
    expect(watermarks.events).toEqual({
      status: 'error',
      floor: '2026-09-01T00:00:00Z',
      boundarySnapshots: new Map(),
    });
  });
});
