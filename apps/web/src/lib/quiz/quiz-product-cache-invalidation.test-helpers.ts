import { vi } from 'vitest';
import type { QuizSweepWatermarks } from './quiz-sweep-watermarks';

export function makeWatermarks(
  floor = '2026-09-01T00:00:00Z',
  overrides: Partial<QuizSweepWatermarks> = {}
): QuizSweepWatermarks {
  return {
    events: {
      status: 'ok',
      floor,
      boundarySnapshots: new Map(),
    },
    reservations: {
      status: 'ok',
      floor,
      boundarySnapshots: new Map(),
    },
    awards: {
      status: 'ok',
      floor,
      boundarySnapshots: new Map(),
    },
    hasProbeFailure: false,
    ...overrides,
  };
}

export function createClient(
  reservationRows: unknown[] = [],
  options: {
    failReservationsAfterFirstPage?: boolean;
  } = {}
) {
  const eventRows = [
    {
      id: 'event-1',
      merchant_id: 'merchant-1',
      settings: { prize_product_id: 'product-1' },
    },
    {
      id: 'event-2',
      merchant_id: 'merchant-2',
      settings: { title: 'Trivia only' },
    },
  ];
  const awardRows = [
    {
      event_id: 'event-2',
      product_id: 'product-2',
      quiz_events: { merchant_id: 'merchant-2' },
    },
  ];
  const orderCalls: Array<{ column: unknown; table: string }> = [];
  const inCalls: Array<{ column: unknown; table: string }> = [];
  return {
    orderCalls,
    inCalls,
    from: vi.fn((table: string) => {
      const rows: unknown[] =
        table === 'quiz_events'
          ? eventRows
          : table === 'quiz_awards'
            ? awardRows
            : table === 'quiz_prize_reservations'
              ? reservationRows
              : [];
      const builder: {
        data: unknown;
        error: unknown;
        select: ReturnType<typeof vi.fn>;
        gte: ReturnType<typeof vi.fn>;
        order: ReturnType<typeof vi.fn>;
        range: ReturnType<typeof vi.fn>;
        not: ReturnType<typeof vi.fn>;
        in: ReturnType<typeof vi.fn>;
      } = {
        data: rows,
        error: null,
        select: vi.fn(() => builder),
        gte: vi.fn(() => builder),
        order: vi.fn((column: unknown) => {
          orderCalls.push({ table, column });
          return builder;
        }),
        range: vi.fn((from: number, to: number) => {
          if (
            options.failReservationsAfterFirstPage &&
            table === 'quiz_prize_reservations' &&
            from > 0
          ) {
            throw new Error('page unavailable');
          }
          builder.data = rows.slice(from, to + 1);
          return builder;
        }),
        not: vi.fn(() => builder),
        in: vi.fn((column: unknown) => {
          inCalls.push({ table, column });
          return builder;
        }),
      };
      return builder;
    }),
  };
}
