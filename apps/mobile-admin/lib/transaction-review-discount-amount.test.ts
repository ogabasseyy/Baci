import { describe, expect, it } from 'vitest';
import { getPersistedTransactionDiscountAmount } from './transaction-review-discount-amount';

describe('getPersistedTransactionDiscountAmount', () => {
  it('sums merchandise and VAT relief allocations', () => {
    expect(
      getPersistedTransactionDiscountAmount({
        lineDiscounts: [
          { lineId: 1, merchandiseDiscount: 20, vatRelief: 1.5 },
          null,
          { lineId: 2, merchandiseDiscount: 5, vatRelief: 0 },
        ],
      })
    ).toBe(26.5);
  });

  it('returns null when no persisted allocations exist', () => {
    expect(getPersistedTransactionDiscountAmount(undefined)).toBeNull();
  });
});
