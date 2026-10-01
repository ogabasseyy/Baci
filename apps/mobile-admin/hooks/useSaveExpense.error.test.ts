import { describe, expect, it, vi } from 'vitest';
import { ExpenseConflictError } from './useSaveExpense';

vi.mock('@/lib/expense-receipt', () => ({
  expenseReceiptStorage: { removeOwned: vi.fn(), upload: vi.fn() },
}));
vi.mock('@/lib/expense-receipt-path', () => ({
  assertOwnedExpenseReceiptPath: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {},
}));

describe('useSaveExpense errors', () => {
  it('uses an ExpenseConflictError for a missing optimistic update row', () => {
    const error = new ExpenseConflictError();

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(
      'This expense changed elsewhere. Reload it before saving again.'
    );
  });
});
