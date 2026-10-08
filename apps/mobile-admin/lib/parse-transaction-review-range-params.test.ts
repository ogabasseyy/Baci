import { describe, expect, it } from 'vitest';
import { parseTransactionReviewRangeParams } from './parse-transaction-review-range-params';

describe('parseTransactionReviewRangeParams', () => {
  it('parses a valid range', () => {
    expect(
      parseTransactionReviewRangeParams('2026-10-01', '2026-10-08')
    ).toEqual({
      endDate: new Date('2026-10-08'),
      startDate: new Date('2026-10-01'),
    });
  });

  it('uses the first value of repeated params', () => {
    expect(
      parseTransactionReviewRangeParams(
        ['2026-10-01', '2026-10-02'],
        ['2026-10-08']
      )
    ).toEqual({
      endDate: new Date('2026-10-08'),
      startDate: new Date('2026-10-01'),
    });
  });

  it.each([
    ['missing start', undefined, '2026-10-08'],
    ['missing end', '2026-10-01', undefined],
    ['invalid start', 'not-a-date', '2026-10-08'],
    ['invalid end', '2026-10-01', 'not-a-date'],
    ['reversed range', '2026-10-08', '2026-10-01'],
  ])('rejects %s', (_label, start, end) => {
    expect(parseTransactionReviewRangeParams(start, end)).toBeUndefined();
  });
});
