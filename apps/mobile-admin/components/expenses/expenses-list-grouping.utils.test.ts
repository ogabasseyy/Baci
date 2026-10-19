import { describe, expect, it } from 'vitest';
import type { Expense } from '@/schemas/expense';
import { groupExpensesByMonthAndGroup } from './expenses-list-grouping.utils';

const MERCHANT_ID = 'cae013e3-719e-4baa-9ab9-45d080ce23ea';

function makeExpense(
  values: Pick<
    Expense,
    'amount' | 'category' | 'date' | 'description' | 'id'
  > & { group_id?: string | null }
): Expense {
  return {
    ...values,
    branch_id: null,
    created_by_user_id: null,
    group_id: values.group_id ?? null,
    merchant_id: MERCHANT_ID,
    payment_method: null,
    receipt_storage_path: null,
    receipt_url: null,
    reference: null,
    updated_at: '2026-06-28T12:00:00.000Z',
    updated_by_user_id: null,
    vendor_name: null,
  };
}

describe('groupExpensesByMonthAndGroup', () => {
  it('shows custom group and fallback category sections with totals', () => {
    const expenses = [
      makeExpense({
        amount: 100,
        category: 'Maintenance',
        date: '2026-06-28',
        description: 'Door',
        id: 'maintenance-1',
      }),
      makeExpense({
        amount: 200,
        category: 'Maintenance',
        date: '2026-06-27',
        description: 'Chair',
        id: 'maintenance-2',
      }),
      makeExpense({
        amount: 300,
        category: 'Office',
        date: '2026-06-26',
        description: 'Operations supplies',
        group_id: 'group-1',
        id: 'operations-1',
      }),
      makeExpense({
        amount: 400,
        category: 'Travel',
        date: '2026-06-25',
        description: 'Taxi',
        group_id: 'group-1',
        id: 'operations-2',
      }),
    ];

    const { data, stickyHeaderIndices } = groupExpensesByMonthAndGroup(
      expenses,
      [{ id: 'group-1', name: 'Operations' }],
      new Date(2026, 5, 28)
    );

    expect(stickyHeaderIndices).toEqual([0]);
    expect(data.map((item) => item.type)).toEqual([
      'header',
      'group-header',
      'item',
      'item',
      'group-header',
      'item',
      'item',
    ]);
    expect(data[1]).toMatchObject({
      count: 2,
      title: 'Maintenance',
      total: 300,
      type: 'group-header',
    });
    expect(data[4]).toMatchObject({
      count: 2,
      title: 'Group · Operations',
      total: 700,
      type: 'group-header',
    });
  });

  it('keeps unresolved group ids separate from category sections', () => {
    const expenses = [
      makeExpense({
        amount: 100,
        category: 'Travel',
        date: '2026-06-28',
        description: 'Known group',
        group_id: '11111111-1111-4111-8111-111111111111',
        id: 'missing-a',
      }),
      makeExpense({
        amount: 200,
        category: 'Travel',
        date: '2026-06-27',
        description: 'Unassigned',
        id: 'unassigned',
      }),
      makeExpense({
        amount: 300,
        category: 'Travel',
        date: '2026-06-26',
        description: 'Another missing group',
        group_id: '22222222-2222-4222-8222-222222222222',
        id: 'missing-b',
      }),
    ];

    const { data } = groupExpensesByMonthAndGroup(
      expenses,
      [],
      new Date(2026, 5, 28)
    );
    const headers = data.filter((item) => item.type === 'group-header');

    expect(headers).toHaveLength(3);
    expect(headers.map((item) => item.title)).toEqual([
      'Group unavailable · 111111111111',
      'Travel',
      'Group unavailable · 222222222222',
    ]);
    expect(headers.map((item) => item.key)).toEqual([
      'expenses-group-header-2026-06-unresolved-group-11111111-1111-4111-8111-111111111111',
      'expenses-group-header-2026-06-category-Travel',
      'expenses-group-header-2026-06-unresolved-group-22222222-2222-4222-8222-222222222222',
    ]);
  });

  it('disambiguates a custom group that shares a category name', () => {
    const expenses = [
      makeExpense({
        amount: 100,
        category: 'Travel',
        date: '2026-06-28',
        description: 'Unassigned travel',
        id: 'unassigned-travel',
      }),
      makeExpense({
        amount: 200,
        category: 'Office',
        date: '2026-06-27',
        description: 'Travel group expense',
        group_id: 'group-travel',
        id: 'grouped-travel',
      }),
    ];

    const { data } = groupExpensesByMonthAndGroup(
      expenses,
      [{ id: 'group-travel', name: 'Travel' }],
      new Date(2026, 5, 28)
    );
    const headers = data.filter((item) => item.type === 'group-header');

    expect(headers.map((item) => item.title)).toEqual([
      'Travel',
      'Group · Travel',
    ]);
  });
});
