import { describe, expect, it } from 'vitest';
import { parseExpenseAmount } from './expense-amount';

describe('parseExpenseAmount', () => {
  it('parses comma-formatted values', () => {
    expect(parseExpenseAmount('12,500.50')).toBe(12500.5);
  });

  it.each([
    '',
    'not-a-number',
  ])('falls back to zero for invalid text: %s', (value) => {
    expect(parseExpenseAmount(value)).toBe(0);
  });
});
