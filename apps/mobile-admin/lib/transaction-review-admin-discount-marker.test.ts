import { describe, expect, it } from 'vitest';
import { isAdminEditedTransactionDiscount } from './transaction-review-admin-discount-marker';

describe('isAdminEditedTransactionDiscount', () => {
  it('recognizes only the server-authored admin-edit marker', () => {
    expect(
      isAdminEditedTransactionDiscount({
        baci_transaction_discount: { status: 'admin_edit', version: 4 },
      })
    ).toBe(true);
    expect(
      isAdminEditedTransactionDiscount({
        baci_transaction_discount: { status: 'admin_edit', version: 3 },
      })
    ).toBe(false);
    expect(isAdminEditedTransactionDiscount(null)).toBe(false);
  });
});
