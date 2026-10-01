import type { ExpenseCategory } from '@/components/expenses/expense-categories';
import { expenseDateCodec } from '@/lib/expense-date';
import type { BranchScope } from '@/schemas/branch';

export interface ExpenseFilters {
  datePreset: 'all' | 'this_month' | 'last_month' | 'custom';
  startDate: string | null;
  endDate: string | null;
  category: ExpenseCategory | 'all';
  branchId: string | 'all';
  groupId: string | 'all' | 'ungrouped';
}

export const DEFAULT_EXPENSE_FILTERS: ExpenseFilters = {
  datePreset: 'this_month',
  startDate: null,
  endDate: null,
  category: 'all',
  branchId: 'all',
  groupId: 'all',
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isDateOnly(value: string | null): value is string {
  return (
    value !== null &&
    DATE_ONLY_PATTERN.test(value) &&
    expenseDateCodec.fromDateOnly(value) !== null
  );
}

function formatDateOnly(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDateParts(
  date: Date,
  timeZone: string
): {
  day: number;
  month: number;
  year: number;
} {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return {
    day: Number(values.day),
    month: Number(values.month),
    year: Number(values.year),
  };
}

function getMonthRange(
  preset: Extract<ExpenseFilters['datePreset'], 'this_month' | 'last_month'>,
  now: Date,
  timeZone: string
): Pick<ExpenseFilters, 'startDate' | 'endDate'> {
  const localNow = getDateParts(now, timeZone);
  const monthOffset = preset === 'last_month' ? -1 : 0;
  const firstOfMonth = new Date(
    Date.UTC(localNow.year, localNow.month - 1 + monthOffset, 1)
  );
  const year = firstOfMonth.getUTCFullYear();
  const month = firstOfMonth.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    startDate: formatDateOnly(year, month, 1),
    endDate: formatDateOnly(year, month, lastDay),
  };
}

function normalizeCustomRange(
  startDate: string | null,
  endDate: string | null
): Pick<ExpenseFilters, 'startDate' | 'endDate'> {
  const normalizedStartDate = isDateOnly(startDate) ? startDate : null;
  const normalizedEndDate = isDateOnly(endDate) ? endDate : null;

  if (
    normalizedStartDate &&
    normalizedEndDate &&
    normalizedStartDate > normalizedEndDate
  ) {
    return {
      startDate: normalizedEndDate,
      endDate: normalizedStartDate,
    };
  }

  return {
    startDate: normalizedStartDate,
    endDate: normalizedEndDate,
  };
}

export function normalizeExpenseFilters(
  filters: ExpenseFilters,
  branchScope: BranchScope,
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
): ExpenseFilters {
  const dateRange =
    filters.datePreset === 'this_month' || filters.datePreset === 'last_month'
      ? getMonthRange(filters.datePreset, now, timeZone)
      : filters.datePreset === 'custom'
        ? normalizeCustomRange(filters.startDate, filters.endDate)
        : { startDate: null, endDate: null };

  return {
    ...filters,
    ...dateRange,
    branchId:
      branchScope.type === 'branch' ? branchScope.branchId : filters.branchId,
  };
}

export function getActiveExpenseFilterCount(
  filters: ExpenseFilters,
  branchScope?: BranchScope
): number {
  return [
    filters.datePreset !== DEFAULT_EXPENSE_FILTERS.datePreset,
    filters.category !== DEFAULT_EXPENSE_FILTERS.category,
    branchScope?.type === 'branch'
      ? false
      : filters.branchId !== DEFAULT_EXPENSE_FILTERS.branchId,
    filters.groupId !== DEFAULT_EXPENSE_FILTERS.groupId,
  ].filter(Boolean).length;
}

export function getExpenseFiltersQueryKey(
  merchantId: string,
  filters: ExpenseFilters
): readonly ['expenses', string, ExpenseFilters] {
  return ['expenses', merchantId, { ...filters }];
}
