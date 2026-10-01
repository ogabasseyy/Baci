import { describe, expect, it } from 'vitest';
import { ExpenseDisplaySchema, ExpenseSchema } from './expense';

const validExpense = {
  amount: 12_500,
  branch_id: null,
  category: 'Other',
  created_by_user_id: null,
  date: '2026-08-09',
  description: null,
  group_id: null,
  id: 'expense-1',
  merchant_id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e',
  payment_method: null,
  receipt_storage_path: null,
  receipt_url: null,
  reference: null,
  updated_at: '2026-08-09T12:00:00.000Z',
  updated_by_user_id: null,
  vendor_name: null,
};

describe('ExpenseSchema', () => {
  it('parses complete expense rows returned by Supabase', () => {
    expect(
      ExpenseSchema.parse({
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
    ).toEqual({
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
    });
  });

  it('retains nullable expense metadata for legacy and ungrouped rows', () => {
    expect(
      ExpenseSchema.parse({
        amount: 1,
        branch_id: null,
        category: 'Other',
        created_by_user_id: null,
        date: '2026-08-09',
        description: null,
        group_id: null,
        id: 'expense-1',
        merchant_id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e',
        payment_method: null,
        receipt_storage_path: null,
        receipt_url: 'https://example.com/legacy-receipt.jpg',
        reference: null,
        updated_at: '2026-08-09T12:00:00.000Z',
        updated_by_user_id: null,
        vendor_name: null,
      })
    ).toMatchObject({
      group_id: null,
      receipt_storage_path: null,
      receipt_url: 'https://example.com/legacy-receipt.jpg',
      vendor_name: null,
    });
  });

  it('rejects a malformed amount before the UI renders an expense row', () => {
    expect(() =>
      ExpenseSchema.parse({ ...validExpense, amount: '12500' })
    ).toThrow();
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('rejects the non-finite amount %s before the UI renders an expense row', (amount) => {
    expect(() => ExpenseSchema.parse({ ...validExpense, amount })).toThrow();
  });

  it.each([
    0, -0.01,
  ])('rejects the non-positive amount %s before the UI renders an expense row', (amount) => {
    expect(() => ExpenseSchema.parse({ ...validExpense, amount })).toThrow();
  });

  it('rejects a malformed merchant identity before exposing an expense row', () => {
    expect(() =>
      ExpenseSchema.parse({ ...validExpense, merchant_id: 'merchant-1' })
    ).toThrow();
  });

  it('rejects a row outside the declared expense projection', () => {
    expect(() =>
      ExpenseSchema.parse({
        ...validExpense,
        unexpected_column: 'must not be silently accepted',
      })
    ).toThrow();
  });
});

describe('ExpenseDisplaySchema', () => {
  it.each([
    'NaN',
    'Infinity',
    '-Infinity',
  ])('normalizes serialized legacy non-finite amount %s', (amount) => {
    const parsed = ExpenseDisplaySchema.parse({ ...validExpense, amount });
    expect(parsed.amount).toBe(0);
    expect(parsed.amountWasLegacySpecial).toBe(true);
  });
  it('keeps legacy non-positive rows available for correction instead of dropping the list', () => {
    expect(
      ExpenseDisplaySchema.parse({ ...validExpense, amount: 0 }).amount
    ).toBe(0);
    expect(
      ExpenseDisplaySchema.parse({ ...validExpense, amount: -1 }).amount
    ).toBe(-1);
  });
});
