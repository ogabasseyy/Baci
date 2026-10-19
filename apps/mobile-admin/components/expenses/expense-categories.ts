export const EXPENSE_CATEGORIES = [
  'Inventory',
  'Marketing',
  'Salaries',
  'Rent',
  'Utilities',
  'Software',
  'Travel',
  'Meals',
  'Maintenance',
  'Other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export function toExpenseCategoryOrNull(
  value: unknown
): ExpenseCategory | null {
  return typeof value === 'string' &&
    EXPENSE_CATEGORIES.includes(value as ExpenseCategory)
    ? (value as ExpenseCategory)
    : null;
}
