import { describe, expect, it } from 'vitest';
import { SaveExpenseInputSchema } from './expense-save';

const base = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  mode: 'create' as const,
  receiptChange: { kind: 'unchanged' as const },
  values: {
    amount: 100,
    branchId: '22222222-2222-4222-8222-222222222222',
    category: 'Meals' as const,
    date: '2026-08-13',
    description: null,
    groupId: null,
    paymentMethod: null,
    reference: null,
    vendorName: null,
  },
};

describe('SaveExpenseInputSchema', () => {
  it('accepts a valid create payload and receipt metadata', () => {
    expect(
      SaveExpenseInputSchema.parse({
        ...base,
        receiptChange: {
          kind: 'replace',
          localUri: 'content://media/123',
          fileName: 'receipt.png',
          mimeType: 'image/png',
        },
      }).mode
    ).toBe('create');
  });

  it('rejects non-positive amounts and malformed replacement receipts', () => {
    expect(() =>
      SaveExpenseInputSchema.parse({
        ...base,
        values: { ...base.values, amount: 0 },
      })
    ).toThrow();
    expect(() =>
      SaveExpenseInputSchema.parse({
        ...base,
        receiptChange: { kind: 'replace', localUri: '' },
      })
    ).toThrow();
  });

  it('accepts the edit grandfathering marker for a legacy special amount', () => {
    expect(
      SaveExpenseInputSchema.parse({
        ...base,
        mode: 'edit',
        expenseId: '33333333-3333-4333-8333-333333333333',
        expectedUpdatedAt: '2026-08-13T00:00:00.000Z',
        originalAmount: 0,
        amountWasLegacySpecial: true,
        originalBranchId: base.values.branchId,
        originalCategory: base.values.category,
        originalDescription: null,
        originalLegacyReceiptUrl: null,
        originalReceiptStoragePath: null,
        values: {
          ...base.values,
          branchId: base.values.branchId,
          category: base.values.category,
        },
      }).mode
    ).toBe('edit');
  });
});
