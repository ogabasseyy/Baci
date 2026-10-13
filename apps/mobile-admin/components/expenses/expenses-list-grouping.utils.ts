import type { Expense } from '@/schemas/expense';
import type { ExpenseGroup } from '@/schemas/expense-group';
import {
  type GroupedExpenseListItem,
  getExpenseDateSortValue,
  getLocalMonthKey,
} from './expenses-list.utils';

type ExpenseGroupOption = Pick<ExpenseGroup, 'id' | 'name'>;

function getMonthGroupTitle(
  monthKey: string,
  currentMonthKey: string | null
): string {
  if (monthKey === 'unknown') {
    return 'Unknown Month';
  }

  if (monthKey === currentMonthKey) {
    return 'This Month';
  }

  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1, 1);

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
  });
}

function getExpenseGroupKey(
  expense: Expense,
  groupsById: Map<string, ExpenseGroupOption>
): { key: string; title: string } {
  if (expense.group_id) {
    const group = groupsById.get(expense.group_id);
    if (group) {
      return {
        key: `group-${group.id}`,
        title: `Group · ${group.name}`,
      };
    }

    const unresolvedGroupLabel = expense.group_id
      .replace(/-/g, '')
      .slice(0, 12);
    return {
      key: `unresolved-group-${expense.group_id}`,
      title: `Group unavailable · ${unresolvedGroupLabel}`,
    };
  }

  return {
    key: `category-${expense.category}`,
    title: expense.category,
  };
}

export function groupExpensesByMonthAndGroup(
  expensesList: Expense[],
  groups: ExpenseGroupOption[],
  now = new Date()
): {
  data: GroupedExpenseListItem[];
  stickyHeaderIndices: number[];
} {
  const expensesByMonth = new Map<string, Expense[]>();
  const groupsById = new Map(groups.map((group) => [group.id, group]));

  for (const expense of expensesList) {
    const monthKey = getLocalMonthKey(expense.date) ?? 'unknown';
    const monthExpenses = expensesByMonth.get(monthKey);
    if (monthExpenses) {
      monthExpenses.push(expense);
    } else {
      expensesByMonth.set(monthKey, [expense]);
    }
  }

  const currentMonthKey = getLocalMonthKey(now);
  const data: GroupedExpenseListItem[] = [];
  const stickyHeaderIndices: number[] = [];
  const sortedMonthKeys = [...expensesByMonth.keys()]
    .filter((key) => key !== 'unknown')
    .sort((a, b) => b.localeCompare(a));

  if (expensesByMonth.has('unknown')) {
    sortedMonthKeys.push('unknown');
  }

  for (const monthKey of sortedMonthKeys) {
    const monthExpenses = [...(expensesByMonth.get(monthKey) ?? [])].sort(
      (a, b) =>
        getExpenseDateSortValue(b.date) - getExpenseDateSortValue(a.date)
    );
    stickyHeaderIndices.push(data.length);
    data.push({
      type: 'header',
      key: `expenses-header-${monthKey}`,
      monthKey,
      title: getMonthGroupTitle(monthKey, currentMonthKey),
      total: monthExpenses.reduce((sum, expense) => sum + expense.amount, 0),
      count: monthExpenses.length,
    });

    const expensesByGroup = new Map<
      string,
      { title: string; expenses: Expense[] }
    >();
    for (const expense of monthExpenses) {
      const group = getExpenseGroupKey(expense, groupsById);
      const groupExpenses = expensesByGroup.get(group.key);
      if (groupExpenses) {
        groupExpenses.expenses.push(expense);
      } else {
        expensesByGroup.set(group.key, {
          title: group.title,
          expenses: [expense],
        });
      }
    }

    for (const [groupKey, group] of expensesByGroup) {
      data.push({
        type: 'group-header',
        key: `expenses-group-header-${monthKey}-${groupKey}`,
        monthKey,
        groupKey,
        title: group.title,
        total: group.expenses.reduce((sum, expense) => sum + expense.amount, 0),
        count: group.expenses.length,
      });
      for (const expense of group.expenses) {
        data.push({
          type: 'item',
          key: `expense-item-${expense.id}`,
          data: expense,
        });
      }
    }
  }

  return { data, stickyHeaderIndices };
}
