import { describe, expect, it } from 'vitest';
import {
  hasQuizSweepWatermarksChanged,
  type QuizSweepWatermarks,
  serializeBoundaryRowState,
  shouldSkipUnchangedBoundaryRow,
  toCanonicalIsoTimestamp,
} from './quiz-sweep-boundary-state';

function makeWatermarks(
  overrides: Partial<QuizSweepWatermarks> = {}
): QuizSweepWatermarks {
  return {
    events: {
      status: 'ok',
      floor: '2026-09-01T00:00:00.000Z',
      boundarySnapshots: new Map([['evt-1', 'snap-1']]),
    },
    reservations: {
      status: 'empty',
      floor: '1970-01-01T00:00:00.000Z',
      boundarySnapshots: new Map(),
    },
    awards: {
      status: 'ok',
      floor: '2026-09-01T00:00:00.000Z',
      boundarySnapshots: new Map([['awd-1', 'snap-a']]),
    },
    hasProbeFailure: false,
    ...overrides,
  };
}

describe('quiz-sweep-boundary-state', () => {
  it('canonicalizes valid timestamps and rejects invalid inputs', () => {
    expect(toCanonicalIsoTimestamp('2026-09-01T00:00:00+00:00')).toBe(
      '2026-09-01T00:00:00.000Z'
    );
    expect(toCanonicalIsoTimestamp('not-a-date')).toBeNull();
    expect(toCanonicalIsoTimestamp(123)).toBeNull();
  });

  it('produces deterministic boundary row fingerprints independent of nested key order', () => {
    const a = serializeBoundaryRowState('quiz_events', {
      id: 'evt-1',
      merchant_id: 'm-1',
      status: 'ended',
      updated_at: '2026-09-01T00:00:00+00:00',
      settings: { b: 2, a: 1 },
    });
    const b = serializeBoundaryRowState('quiz_events', {
      id: 'evt-1',
      merchant_id: 'm-1',
      status: 'ended',
      updated_at: '2026-09-01T00:00:00.000Z',
      settings: { a: 1, b: 2 },
    });
    expect(a).toBe(b);
  });

  it('skips only unchanged boundary rows at the exact floor timestamp', () => {
    const row = {
      id: 'evt-1',
      merchant_id: 'm-1',
      status: 'ended',
      updated_at: '2026-09-01T00:00:00.000Z',
      settings: { prize_product_id: 'prod-1' },
    };
    const watermark = {
      status: 'ok' as const,
      floor: '2026-09-01T00:00:00+00:00',
      boundarySnapshots: new Map([
        ['evt-1', serializeBoundaryRowState('quiz_events', row)],
      ]),
    };

    expect(
      shouldSkipUnchangedBoundaryRow(
        'quiz_events',
        'updated_at',
        watermark,
        row
      )
    ).toBe(true);
    expect(
      shouldSkipUnchangedBoundaryRow('quiz_events', 'updated_at', watermark, {
        ...row,
        status: 'finalized',
      })
    ).toBe(false);
    expect(
      shouldSkipUnchangedBoundaryRow('quiz_events', 'updated_at', watermark, {
        ...row,
        updated_at: '2026-09-01T00:00:01.000Z',
      })
    ).toBe(false);
  });

  it('detects floor, status, and boundary snapshot changes across ticks', () => {
    const base = makeWatermarks();
    expect(hasQuizSweepWatermarksChanged(base, makeWatermarks())).toBe(false);
    expect(
      hasQuizSweepWatermarksChanged(
        base,
        makeWatermarks({
          events: {
            ...base.events,
            floor: '2026-09-01T00:00:00+00:00',
          },
        })
      )
    ).toBe(false);
    expect(
      hasQuizSweepWatermarksChanged(
        base,
        makeWatermarks({
          events: {
            ...base.events,
            floor: '2026-09-01T00:00:05.000Z',
          },
        })
      )
    ).toBe(true);
    expect(
      hasQuizSweepWatermarksChanged(
        base,
        makeWatermarks({
          awards: {
            ...base.awards,
            boundarySnapshots: new Map([['awd-1', 'snap-b']]),
          },
        })
      )
    ).toBe(true);
  });
});
