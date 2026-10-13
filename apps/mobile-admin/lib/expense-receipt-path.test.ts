import { describe, expect, it } from 'vitest';
import { assertOwnedExpenseReceiptPath } from './expense-receipt-path';

const merchantId = '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e';
const receiptFileName = '31bc282a-c36d-4bc8-815e-731ac75d1c01.jpg';

describe('assertOwnedExpenseReceiptPath', () => {
  it('accepts only a generated receipt filename in the active merchant folder', () => {
    expect(() =>
      assertOwnedExpenseReceiptPath(
        merchantId,
        `${merchantId}/expenses/${receiptFileName}`
      )
    ).not.toThrow();
  });

  it('rejects paths with foreign merchants, traversal, encoding, separators, or unsafe names', () => {
    const unsafePaths = [
      'd33f52db-209c-4724-8fa2-8bde6d7c8d41/expenses/31bc282a-c36d-4bc8-815e-731ac75d1c01.jpg',
      `${merchantId}/expenses/`,
      `${merchantId}/expenses/.`,
      `${merchantId}/expenses/../${receiptFileName}`,
      `${merchantId}/expenses//${receiptFileName}`,
      `${merchantId}/expenses/nested/${receiptFileName}`,
      `${merchantId}/expenses/%2e%2e%2f${receiptFileName}`,
      `${merchantId}/expenses/..\\${receiptFileName}`,
      `not-a-uuid/expenses/${receiptFileName}`,
    ];

    for (const storagePath of unsafePaths) {
      expect(() =>
        assertOwnedExpenseReceiptPath(merchantId, storagePath)
      ).toThrow('Receipt path is not owned by the active merchant');
    }
  });

  it('accepts a database-approved safe receipt filename', () => {
    expect(() =>
      assertOwnedExpenseReceiptPath(
        merchantId,
        `${merchantId}/expenses/receipt.jpg`
      )
    ).not.toThrow();
  });
});
