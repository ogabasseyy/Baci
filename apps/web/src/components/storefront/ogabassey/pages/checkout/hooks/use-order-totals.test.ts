import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useOrderTotals } from './use-order-totals';

describe('useOrderTotals', () => {
  it('returns a current tax preview immediately and updates with its inputs', () => {
    const { result, rerender } = renderHook(
      ({ cartTotal, deliveryCost, taxRate }) =>
        useOrderTotals({ cartTotal, deliveryCost, taxRate }),
      { initialProps: { cartTotal: 1000, deliveryCost: 80, taxRate: 0.12 } }
    );

    expect(result.current).toEqual({ total: 1200, taxAmount: 120 });

    rerender({ cartTotal: 2000, deliveryCost: 80, taxRate: 0.12 });

    expect(result.current).toEqual({ total: 2320, taxAmount: 240 });
  });
});
