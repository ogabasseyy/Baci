import { describe, expect, it } from 'vitest';
import { createDeliveryBudget } from './delivery-budget';

describe('public observer delivery budget', () => {
  it('reserves capacity before asynchronous requests finish', () => {
    const budget = createDeliveryBudget(2);
    const first = budget.reserve();
    const second = budget.reserve();
    expect(first).toBeTypeOf('function');
    expect(second).toBeTypeOf('function');
    expect(budget.reserve()).toBeUndefined();
    first?.(true);
    expect(budget.reserve()).toBeUndefined();
    second?.(false);
    expect(budget.recorded()).toBe(1);
    expect(budget.reserve()).toBeTypeOf('function');
  });
  it('releases failed requests only once and cannot reclaim recorded slots', () => {
    const budget = createDeliveryBudget(1);
    const finish = budget.reserve();
    finish?.(false);
    finish?.(false);
    const next = budget.reserve();
    next?.(true);
    next?.(false);
    expect(budget.recorded()).toBe(1);
    expect(budget.reserve()).toBeUndefined();
  });
});
