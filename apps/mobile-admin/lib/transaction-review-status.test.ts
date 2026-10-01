import { describe, expect, it } from 'vitest';
import { TRANSACTION_REVIEW_EXCLUDED_SHIPPING_STATUSES } from './transaction-review-status';

describe('TRANSACTION_REVIEW_EXCLUDED_SHIPPING_STATUSES', () => {
  it('keeps all terminal shipping statuses excluded from transaction review', () => {
    expect(TRANSACTION_REVIEW_EXCLUDED_SHIPPING_STATUSES).toEqual([
      'cancelled',
      'canceled',
      'returned',
    ]);
  });
});
