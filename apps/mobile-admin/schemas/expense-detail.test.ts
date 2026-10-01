import { describe, expect, it } from 'vitest';
import { ExpenseDetailSchema } from './expense-detail';

describe('ExpenseDetailSchema', () => {
  it('parses all persisted metadata needed by the expense detail screen', () => {
    expect(
      ExpenseDetailSchema.parse({
        amount: 12_500,
        branch_id: 'branch-1',
        category: 'Inventory',
        created_by_user_id: 'user-1',
        date: '2026-08-09',
        description: 'Office internet',
        group_id: 'group-1',
        id: 'expense-1',
        merchant_id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e',
        payment_method: 'Bank transfer',
        receipt_storage_path: 'merchant-1/expenses/receipt.jpg',
        receipt_url: null,
        reference: 'INV-123',
        updated_at: '2026-08-09T12:00:00.000Z',
        updated_by_user_id: 'user-2',
        vendor_name: 'Internet provider',
      })
    ).toMatchObject({
      group_id: 'group-1',
      merchant_id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e',
      payment_method: 'Bank transfer',
      receipt_storage_path: 'merchant-1/expenses/receipt.jpg',
      vendor_name: 'Internet provider',
    });
  });

  it('rejects a detail row with an undeclared projection field', () => {
    expect(() =>
      ExpenseDetailSchema.parse({
        amount: 12_500,
        branch_id: 'branch-1',
        category: 'Inventory',
        created_by_user_id: 'user-1',
        date: '2026-08-09',
        description: 'Office internet',
        group_id: 'group-1',
        id: 'expense-1',
        merchant_id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e',
        payment_method: 'Bank transfer',
        receipt_storage_path: 'merchant-1/expenses/receipt.jpg',
        receipt_url: null,
        reference: 'INV-123',
        unexpected_column: true,
        updated_at: '2026-08-09T12:00:00.000Z',
        updated_by_user_id: 'user-2',
        vendor_name: 'Internet provider',
      })
    ).toThrow();
  });
});
