import { describe, expect, it } from 'vitest';
import { analyticsDataParsers } from './analytics-data-parsers';

describe('analyticsDataParsers', () => {
  it('keeps valid records and converts primitive values safely', () => {
    expect(analyticsDataParsers.asRecord({ value: 1 })).toEqual({ value: 1 });
    expect(analyticsDataParsers.asRecord([])).toBeNull();
    expect(
      analyticsDataParsers.asArray([{ id: 'one' }, null, 'invalid'])
    ).toEqual([{ id: 'one' }]);
    expect(analyticsDataParsers.asNumber('12.5')).toBe(12.5);
    expect(analyticsDataParsers.asNumber('not-a-number')).toBe(0);
    expect(
      analyticsDataParsers.asOptionalNumber('not-a-number')
    ).toBeUndefined();
    expect(analyticsDataParsers.asString('', 'fallback')).toBe('fallback');
  });
});
