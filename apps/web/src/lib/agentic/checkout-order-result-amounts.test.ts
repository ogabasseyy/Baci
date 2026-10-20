import { describe, expect, it } from 'vitest';
import {
  getCreatedOrderId,
  isFiniteAmountLike,
  toFiniteAmount,
} from './checkout-order-result-amounts';

describe('checkout-order-result-amounts', () => {
  it('detects finite amount-likes', () => {
    expect(isFiniteAmountLike(10)).toBe(true);
    expect(isFiniteAmountLike('10')).toBe(true);
    expect(isFiniteAmountLike(null)).toBe(false);
    expect(isFiniteAmountLike(undefined)).toBe(false);
    expect(isFiniteAmountLike(Number.NaN)).toBe(false);
    expect(isFiniteAmountLike('soon')).toBe(false);
  });

  it('coerces to a finite amount with a zero fallback', () => {
    expect(toFiniteAmount('10')).toBe(10);
    expect(toFiniteAmount(null)).toBe(0);
    expect(toFiniteAmount('soon')).toBe(0);
  });

  it('reads the created order id from nested or top-level shapes', () => {
    expect(getCreatedOrderId({ order: { id: 'order-1' } })).toBe('order-1');
    expect(getCreatedOrderId({ id: 'order-2' })).toBe('order-2');
    expect(getCreatedOrderId({ order: { id: 7 } })).toBeUndefined();
    expect(getCreatedOrderId({})).toBeUndefined();
  });
});
