import { describe, expect, it } from 'vitest';
import { ExpenseRouteParamsSchema } from './expense-route-params';

describe('ExpenseRouteParamsSchema', () => {
  it('normalizes repeated route ids to the first value', () => {
    expect(
      ExpenseRouteParamsSchema.parse({
        id: ['6d89c8af-7bef-4b78-a7b5-9c2a63f691e9', 'bad'],
      })
    ).toEqual({ id: '6d89c8af-7bef-4b78-a7b5-9c2a63f691e9' });
  });
  it('accepts only a UUID expense route id', () => {
    expect(
      ExpenseRouteParamsSchema.safeParse({
        id: '6d89c8af-7bef-4b78-a7b5-9c2a63f691e9',
      }).success
    ).toBe(true);
    expect(
      ExpenseRouteParamsSchema.safeParse({ id: 'expense-1' }).success
    ).toBe(false);
    expect(ExpenseRouteParamsSchema.safeParse({ id: undefined }).success).toBe(
      false
    );
    expect(ExpenseRouteParamsSchema.safeParse({ id: [] }).success).toBe(false);
  });
});
