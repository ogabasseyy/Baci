import { describe, expect, it } from 'vitest';
import type { Expense } from '@/schemas/expense';
import {
  type GroupedExpenseListItem,
  getExpenseDateSortValue,
  getLocalMonthKey,
  groupExpensesByMonth,
} from './expenses-list.utils';

describe('getLocalMonthKey', () => {
  it('groups standard timestamp correctly', () => {
    expect(getLocalMonthKey('2026-06-28T12:00:00.000Z')).toBe('2026-06');
  });

  it('groups local Date object correctly', () => {
    const date = new Date(2026, 5, 28); // June 28 (0-indexed month)
    expect(getLocalMonthKey(date)).toBe('2026-06');
  });

  it('handles date-only YYYY-MM-DD strings without timezone shifting', () => {
    expect(getLocalMonthKey('2026-06-01')).toBe('2026-06');
  });

  it('returns null for invalid dates', () => {
    expect(getLocalMonthKey('not-a-date')).toBeNull();
    expect(getLocalMonthKey('2026-13-01')).toBeNull();
    expect(getLocalMonthKey('2026-06-31')).toBeNull(); // June only has 30 days
  });
});

describe('getExpenseDateSortValue', () => {
  it('parses standard timestamp correctly', () => {
    expect(getExpenseDateSortValue('2026-06-28T12:00:00.000Z')).toBe(
      new Date('2026-06-28T12:00:00.000Z').getTime()
    );
  });

  it('parses date-only YYYY-MM-DD strings local-timezone correctly', () => {
    expect(getExpenseDateSortValue('2026-06-01')).toBe(
      new Date(2026, 5, 1).getTime()
    );
  });
});

describe('groupExpensesByMonth', () => {
  const makeExpense = (
    values: Pick<Expense, 'amount' | 'category' | 'date' | 'description' | 'id'>
  ): Expense => ({
    ...values,
    branch_id: null,
    created_by_user_id: null,
    group_id: null,
    merchant_id: 'cae013e3-719e-4baa-9ab9-45d080ce23ea',
    payment_method: null,
    receipt_storage_path: null,
    receipt_url: null,
    reference: null,
    updated_at: '2026-06-28T12:00:00.000Z',
    updated_by_user_id: null,
    vendor_name: null,
  });
  const mockExpenses: Expense[] = [
    makeExpense({
      id: '1',
      amount: 1000,
      category: 'Office',
      description: 'Pens',
      date: '2026-06-28T12:00:00.000Z',
    }),
    makeExpense({
      id: '2',
      amount: 2500,
      category: 'Travel',
      description: 'Cab',
      date: '2026-06-01',
    }),
    makeExpense({
      id: '3',
      amount: 1500,
      category: 'Food',
      description: 'Lunch',
      date: '2026-05-15T09:00:00.000Z',
    }),
  ];

  it('groups expenses by local month', () => {
    const now = new Date('2026-06-28T20:00:00.000Z');
    const { data, stickyHeaderIndices } = groupExpensesByMonth(
      mockExpenses,
      now
    );

    // June 2026 (header) + 2 items + May 2026 (header) + 1 item = 5
    expect(data.length).toBe(5);
    expect(stickyHeaderIndices).toEqual([0, 3]);

    expect(data[0]).toEqual({
      count: 2,
      type: 'header',
      key: 'expenses-header-2026-06',
      monthKey: '2026-06',
      total: 3500,
      title: 'This Month',
    });

    expect(data[1].type).toBe('item');
    expect(data[1].key).toBe('expense-item-1');

    expect(data[2].type).toBe('item');
    expect(data[2].key).toBe('expense-item-2');

    expect(data[3]).toEqual({
      count: 1,
      type: 'header',
      key: 'expenses-header-2026-05',
      monthKey: '2026-05',
      total: 1500,
      title: 'May 2026',
    });
  });

  it('sorts month groups newest first', () => {
    const now = new Date('2026-06-28T20:00:00.000Z');
    const { data } = groupExpensesByMonth(mockExpenses, now);
    const headers = data.filter((item) => item.type === 'header') as Extract<
      GroupedExpenseListItem,
      { type: 'header' }
    >[];
    expect(headers[0].monthKey).toBe('2026-06');
    expect(headers[1].monthKey).toBe('2026-05');
  });

  it('sorts expenses inside each month newest first', () => {
    const unsortedExpenses: Expense[] = [
      makeExpense({
        id: '1',
        amount: 100,
        category: 'Food',
        description: 'Lunch',
        date: '2026-06-01',
      }),
      makeExpense({
        id: '2',
        amount: 200,
        category: 'Travel',
        description: 'Cab',
        date: '2026-06-28',
      }),
    ];

    const now = new Date('2026-06-28T20:00:00.000Z');
    const { data } = groupExpensesByMonth(unsortedExpenses, now);

    // Header + item-2 + item-1
    expect(data[1].key).toBe('expense-item-2');
    expect(data[2].key).toBe('expense-item-1');
  });

  it('returns empty data and empty stickyHeaderIndices for an empty list', () => {
    const { data, stickyHeaderIndices } = groupExpensesByMonth([]);
    expect(data.length).toBe(0);
    expect(stickyHeaderIndices.length).toBe(0);
  });

  it('groups invalid dates under unknown group without crashing', () => {
    const invalidExpenses: Expense[] = [
      makeExpense({
        id: '1',
        amount: 100,
        category: 'Food',
        description: 'Lunch',
        date: 'invalid-date-string',
      }),
    ];

    const { data } = groupExpensesByMonth(invalidExpenses);
    expect(data.length).toBe(2); // Header + item
    expect(data[0]).toEqual({
      count: 1,
      type: 'header',
      key: 'expenses-header-unknown',
      monthKey: 'unknown',
      total: 100,
      title: 'Unknown Month',
    });
  });

  it('uses non-colliding keys for headers and items', () => {
    const { data } = groupExpensesByMonth(mockExpenses);
    const keys = data.map((item) => item.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });
});
