import { describe, expect, it } from 'vitest';
import { type FilterRow, matchesOrFilter } from '../../test/postgrest-filter';
import {
  applyOrderListVisibilityFilter,
  ORDER_LIST_VISIBILITY_FILTER,
} from './order-list-visibility';

function isVisible(row: FilterRow): boolean {
  return matchesOrFilter(row, ORDER_LIST_VISIBILITY_FILTER);
}

const customerCheckout: FilterRow = {
  payment_method: 'paystack',
  payment_status: 'paid',
  recorded_by_user_id: null,
  source: 'online_store',
};

describe('applyOrderListVisibilityFilter', () => {
  it('applies the visibility rules as a single or() group', () => {
    const calls: string[] = [];
    const query = {
      or: (filters: string) => {
        calls.push(filters);
        return query;
      },
    };

    expect(applyOrderListVisibilityFilter(query)).toBe(query);
    expect(calls).toEqual([ORDER_LIST_VISIBILITY_FILTER]);
  });

  it('shows paid customer orders and unpaid ones with no online payment method', () => {
    expect(isVisible(customerCheckout)).toBe(true);
    expect(
      isVisible({
        ...customerCheckout,
        payment_method: null,
        payment_status: 'pending',
      })
    ).toBe(true);
    expect(
      isVisible({
        ...customerCheckout,
        payment_method: 'cash',
        payment_status: 'unpaid',
      })
    ).toBe(true);
  });

  it.each([
    [
      'unpaid online checkout',
      { payment_method: 'bank_transfer', payment_status: 'pending' },
    ],
    ['failed checkout', { payment_status: 'failed' }],
    ['expired checkout', { payment_status: 'expired' }],
    ['checkout awaiting BNPL', { payment_status: 'bnpl_pending' }],
  ])('hides a customer %s', (_label, overrides) => {
    expect(isVisible({ ...customerCheckout, ...overrides })).toBe(false);
  });

  describe('bugfix: staff invoices hidden from the orders list', () => {
    const staffInvoice: FilterRow = {
      payment_method: 'bank_transfer',
      payment_status: 'pending',
      recorded_by_user_id: 'staff-user-1',
      source: 'physical',
    };

    it('shows an unpaid staff invoice whose payment method is bank transfer', () => {
      expect(isVisible(staffInvoice)).toBe(true);
    });

    it.each([
      'failed',
      'expired',
      'bnpl_pending',
    ])('shows a staff invoice whose payment is %s', (paymentStatus) => {
      expect(
        isVisible({ ...staffInvoice, payment_status: paymentStatus })
      ).toBe(true);
    });

    it.each([
      'whatsapp',
      'instagram',
      'physical',
    ])('shows a %s order whose staff creator was cleared', (source) => {
      expect(
        isVisible({
          ...staffInvoice,
          payment_status: 'bnpl_pending',
          recorded_by_user_id: null,
          source,
        })
      ).toBe(true);
    });
  });
});
