import { describe, expect, it } from 'vitest';
import { filterExcludedTransactionReviewRows } from './filter-excluded-transaction-review-rows';

describe('filterExcludedTransactionReviewRows', () => {
  it('removes cancelled, canceled, returned, and timestamp-cancelled rows', () => {
    const activeRow = { id: 'active-order', shipping_status: 'pending' };
    const cancelledRow = {
      id: 'cancelled-order',
      shipping_status: 'cancelled',
    };
    const canceledRow = { id: 'canceled-order', shipping_status: 'canceled' };
    const returnedRow = { id: 'returned-order', shipping_status: 'returned' };
    const timestampCancelledRow = {
      cancelled_at: '2026-07-21T00:00:00.000Z',
      id: 'timestamp-cancelled-order',
      shipping_status: 'pending',
    };
    const legacyRow = { id: 'legacy-order', shipping_status: null };

    const visibleRows = filterExcludedTransactionReviewRows([
      activeRow,
      cancelledRow,
      canceledRow,
      returnedRow,
      timestampCancelledRow,
      legacyRow,
    ]);

    expect(visibleRows).toEqual([activeRow, legacyRow]);
  });
});
