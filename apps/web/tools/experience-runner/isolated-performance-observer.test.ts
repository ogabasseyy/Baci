import { describe, expect, it } from 'vitest';
import {
  ISOLATED_PERFORMANCE_SOURCE,
  parseIsolatedMetricPayload,
  scorePostPaintLayoutShifts,
  sessionWindowCLS,
} from './isolated-performance-observer';

describe('isolated performance observer contract', () => {
  it('uses buffered native observers and session-window CLS rules', () => {
    expect(ISOLATED_PERFORMANCE_SOURCE).toContain(
      "type: 'largest-contentful-paint', buffered: true"
    );
    expect(ISOLATED_PERFORMANCE_SOURCE).toContain(
      "type: 'layout-shift', buffered: true"
    );
    expect(ISOLATED_PERFORMANCE_SOURCE).toContain('entry.hadRecentInput');
    expect(ISOLATED_PERFORMANCE_SOURCE).toContain('>= 1000');
    expect(ISOLATED_PERFORMANCE_SOURCE).toContain('>= 5000');
    expect(ISOLATED_PERFORMANCE_SOURCE).toContain(
      "type: 'paint', buffered: true"
    );
    expect(ISOLATED_PERFORMANCE_SOURCE).toContain('layoutShiftOverflow');
  });

  it('keeps prepaint entries in raw CLS and scores post-first-paint entries', () => {
    const entries = [
      { startTime: 100, value: 1, hadRecentInput: false },
      { startTime: 199, value: 0.11, hadRecentInput: false },
      { startTime: 200, value: 0.2, hadRecentInput: false },
    ];
    expect(scorePostPaintLayoutShifts(entries, 200)).toEqual({
      rawCls: 1.31,
      cls: 0.2,
    });
  });

  it('uses native session windows and excludes recent-input shifts', () => {
    expect(
      sessionWindowCLS([
        { startTime: 100, value: 0.1, hadRecentInput: false },
        { startTime: 999, value: 0.2, hadRecentInput: false },
        { startTime: 1999, value: 0.4, hadRecentInput: false },
        { startTime: 2500, value: 0.8, hadRecentInput: true },
        { startTime: 6999, value: 0.2, hadRecentInput: false },
      ])
    ).toBe(0.4);
  });

  it('keeps late image shifts after first paint and falls back to raw CLS without paint timing', () => {
    const lateImageShift = [
      { startTime: 100, value: 0.02, hadRecentInput: false },
      { startTime: 210, value: 0.12, hadRecentInput: false },
    ];
    expect(scorePostPaintLayoutShifts(lateImageShift, 200).rawCls).toBeCloseTo(
      0.14
    );
    expect(scorePostPaintLayoutShifts(lateImageShift, 200).cls).toBe(0.12);
    expect(scorePostPaintLayoutShifts(lateImageShift, null).cls).toBeCloseTo(
      0.14
    );
  });

  it('accepts nullable LCP but rejects malformed and nonfinite payloads', () => {
    const valid = JSON.stringify({
      timeOrigin: 100,
      lcpMs: null,
      rawCls: 0,
      firstPaintMs: null,
      rawLayoutShifts: [],
      layoutShiftOverflow: false,
      viewport: { width: 800, height: 600 },
    });
    expect(parseIsolatedMetricPayload(valid)?.lcpMs).toBeNull();
    expect(parseIsolatedMetricPayload('{bad')).toBeNull();
    expect(
      parseIsolatedMetricPayload(
        JSON.stringify({
          timeOrigin: Number.POSITIVE_INFINITY,
          lcpMs: 1,
          rawCls: 0,
          firstPaintMs: null,
          rawLayoutShifts: [],
          layoutShiftOverflow: false,
          viewport: { width: 1, height: 1 },
        })
      )
    ).toBeNull();
    expect(
      parseIsolatedMetricPayload(
        JSON.stringify({
          timeOrigin: 1,
          lcpMs: 1,
          rawCls: 0,
          firstPaintMs: null,
          rawLayoutShifts: [],
          layoutShiftOverflow: false,
          viewport: { width: 0, height: Number.NaN },
        })
      )
    ).toBeNull();
  });

  it('rejects malformed entries and preserves overflow as explicit evidence', () => {
    const base = {
      timeOrigin: 100,
      lcpMs: null,
      rawCls: 0,
      firstPaintMs: null,
      rawLayoutShifts: [],
      layoutShiftOverflow: false,
      viewport: { width: 800, height: 600 },
    };
    expect(
      parseIsolatedMetricPayload(
        JSON.stringify({
          ...base,
          rawLayoutShifts: [{ startTime: -1, value: 0, hadRecentInput: false }],
        })
      )
    ).toBeNull();
    expect(
      parseIsolatedMetricPayload(JSON.stringify({ ...base, rawCls: 0.1 }))
    ).toBeNull();
    expect(
      parseIsolatedMetricPayload(JSON.stringify({ ...base, lcpMs: -1 }))
    ).toBeNull();
    expect(
      parseIsolatedMetricPayload(
        JSON.stringify({ ...base, layoutShiftOverflow: true })
      )?.layoutShiftOverflow
    ).toBe(true);
  });
});
