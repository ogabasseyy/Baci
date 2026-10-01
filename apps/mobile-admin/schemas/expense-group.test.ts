import { describe, expect, it } from 'vitest';
import { ExpenseGroupSchema } from './expense-group';

const expenseGroup = {
  archived_at: null,
  created_at: '2026-08-09T12:00:00.000Z',
  id: '02f07db2-10e9-4c60-a0df-a4f5ccba9d9d',
  merchant_id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e',
  name: 'Operations',
  updated_at: '2026-08-09T12:00:00.000Z',
};

describe('ExpenseGroupSchema', () => {
  it('parses archived and active merchant expense groups', () => {
    expect(ExpenseGroupSchema.parse(expenseGroup)).toEqual(expenseGroup);
    expect(
      ExpenseGroupSchema.parse({
        ...expenseGroup,
        archived_at: '2026-08-10T12:00:00.000Z',
      })
    ).toMatchObject({ archived_at: '2026-08-10T12:00:00.000Z' });
  });

  it('rejects malformed group identities and names longer than 80 characters', () => {
    expect(() =>
      ExpenseGroupSchema.parse({ ...expenseGroup, id: 'group-1' })
    ).toThrow();
    expect(() =>
      ExpenseGroupSchema.parse({ ...expenseGroup, name: 'a'.repeat(81) })
    ).toThrow();
  });

  it('rejects undeclared group projection fields', () => {
    expect(() =>
      ExpenseGroupSchema.parse({ ...expenseGroup, expense_count: 3 })
    ).toThrow();
  });

  it('rejects malformed timestamp fields', () => {
    expect(() =>
      ExpenseGroupSchema.parse({ ...expenseGroup, created_at: 'today' })
    ).toThrow();
    expect(() =>
      ExpenseGroupSchema.parse({ ...expenseGroup, updated_at: 'today' })
    ).toThrow();
    expect(() =>
      ExpenseGroupSchema.parse({ ...expenseGroup, archived_at: 'today' })
    ).toThrow();
  });
});
