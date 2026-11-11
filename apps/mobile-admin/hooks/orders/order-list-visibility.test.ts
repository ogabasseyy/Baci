import { describe, expect, it } from 'vitest';
import {
  applyOrderListVisibilityFilter,
  HIDDEN_CHECKOUT_PAYMENT_STATUS_VALUES,
  HIDDEN_CHECKOUT_PAYMENT_STATUSES,
  ONLINE_CHECKOUT_PAYMENT_METHODS,
  VISIBLE_PENDING_ORDER_FILTER,
} from './order-list-visibility';

describe('applyOrderListVisibilityFilter', () => {
  it('emits the checkout drop-off predicates for order list queries', () => {
    const calls: Array<{ args: unknown[]; method: string }> = [];
    const query = {
      not: (column: string, operator: string, value: string) => {
        calls.push({ method: 'not', args: [column, operator, value] });
        return query;
      },
      or: (filters: string) => {
        calls.push({ method: 'or', args: [filters] });
        return query;
      },
    };

    expect(applyOrderListVisibilityFilter(query)).toBe(query);
    expect(calls).toEqual([
      {
        method: 'not',
        args: ['payment_status', 'in', HIDDEN_CHECKOUT_PAYMENT_STATUSES],
      },
      {
        method: 'or',
        args: [VISIBLE_PENDING_ORDER_FILTER],
      },
    ]);
    expect(HIDDEN_CHECKOUT_PAYMENT_STATUS_VALUES).not.toContain('unpaid');
    expect(VISIBLE_PENDING_ORDER_FILTER).toContain(
      'payment_status.not.in.(pending,unpaid)'
    );
    expect(VISIBLE_PENDING_ORDER_FILTER).toContain(
      `payment_method.not.in.${ONLINE_CHECKOUT_PAYMENT_METHODS}`
    );
  });

  it('keeps unpaid staff-created orders visible even with an online payment method', () => {
    // Regression: a staff in-store invoice switched to bank transfer while
    // awaiting payment matched the abandoned-checkout rule and vanished
    // from the orders list.
    expect(VISIBLE_PENDING_ORDER_FILTER.split(',')).toContain(
      'recorded_by_user_id.not.is.null'
    );
  });
});
