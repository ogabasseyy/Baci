import { describe, expect, it } from 'vitest';
import { buildTransactionReviewOrFilter } from './build-transaction-review-or-filter';

const VISIBILITY =
  'shipping_status.is.null,shipping_status.not.in.(cancelled,canceled,returned)';

describe('buildTransactionReviewOrFilter', () => {
  it('returns only the visibility filter without transaction dates', () => {
    expect(
      buildTransactionReviewOrFilter({ includeTransactionDate: false })
    ).toBe(VISIBILITY);
  });

  it('returns only the visibility filter when no range is set', () => {
    expect(
      buildTransactionReviewOrFilter({ includeTransactionDate: true })
    ).toBe(VISIBILITY);
  });

  it('merges visibility with the date range in a single filter', () => {
    expect(
      buildTransactionReviewOrFilter({
        endDateFilter: 'transaction_date.lte.2026-10-08',
        includeTransactionDate: true,
        startDateFilter: 'transaction_date.gte.2026-10-01',
      })
    ).toBe(
      `and(or(${VISIBILITY}),or(transaction_date.gte.2026-10-01),or(transaction_date.lte.2026-10-08))`
    );
  });
});
