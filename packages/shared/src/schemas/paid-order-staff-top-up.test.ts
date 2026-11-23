import { expect, it } from 'vitest';
import { staffTopUpSchema } from './paid-order-staff-top-up';

it.each([
  1, 7, 8, 100,
])('accepts a staff POS reference with %s characters', (length) => {
  const receiptReference = 'R'.repeat(length);
  expect(
    staffTopUpSchema.parse({
      method: 'pos',
      receiptReference: ` ${receiptReference} `,
    })
  ).toEqual({ method: 'pos', receiptReference });
});

it('requires a terminal reference for POS and reserves it for POS', () => {
  expect(staffTopUpSchema.parse({ method: 'cash' })).toEqual({
    method: 'cash',
  });
  expect(
    staffTopUpSchema.safeParse({ method: 'cash', receiptReference: 'R' })
      .success
  ).toBe(false);
  expect(staffTopUpSchema.safeParse({ method: 'pos' }).success).toBe(false);
  for (const receiptReference of ['  ', '/A', 'A B', 'A'.repeat(101)]) {
    expect(
      staffTopUpSchema.safeParse({ method: 'pos', receiptReference }).success
    ).toBe(false);
  }
});
