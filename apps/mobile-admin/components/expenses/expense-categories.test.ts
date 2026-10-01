import { describe, expect, it } from 'vitest';
import { toExpenseCategoryOrNull } from './expense-categories';

describe('toExpenseCategoryOrNull', () => {
  it('accepts supported categories and rejects unknown input', () => {
    expect(toExpenseCategoryOrNull('Meals')).toBe('Meals');
    expect(toExpenseCategoryOrNull('food')).toBeNull();
    expect(toExpenseCategoryOrNull(null)).toBeNull();
  });
});
