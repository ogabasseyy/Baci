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

  describe('bugfix: unpaid staff invoice hidden after switching to bank transfer', () => {
    type Row = Record<string, string | null>;

    // Split a PostgREST or() group on top-level commas only.
    function splitTopLevel(filter: string): string[] {
      const parts: string[] = [];
      let depth = 0;
      let current = '';
      for (const char of filter) {
        if (char === '(') depth += 1;
        if (char === ')') depth -= 1;
        if (char === ',' && depth === 0) {
          parts.push(current);
          current = '';
          continue;
        }
        current += char;
      }
      parts.push(current);
      return parts;
    }

    // Evaluates the predicate forms these filters use, with SQL NULL
    // semantics (a NULL compared with not.in matches nothing).
    function matches(row: Row, predicate: string): boolean {
      const [column, ...rest] = predicate.split('.');
      const operator = rest.slice(0, -1).join('.');
      const operand = rest[rest.length - 1];
      const value = row[column] ?? null;
      const list = () => operand.replace(/^\(|\)$/g, '').split(',');
      if (operator === 'is' && operand === 'null') return value === null;
      if (operator === 'not.is' && operand === 'null') return value !== null;
      if (operator === 'not.in')
        return value !== null && !list().includes(value);
      throw new Error(`unsupported predicate: ${predicate}`);
    }

    function isVisible(row: Row): boolean {
      const hidden = HIDDEN_CHECKOUT_PAYMENT_STATUS_VALUES as readonly string[];
      if (row.payment_status !== null && hidden.includes(row.payment_status)) {
        return false;
      }
      return splitTopLevel(VISIBLE_PENDING_ORDER_FILTER).some((predicate) =>
        matches(row, predicate)
      );
    }

    const staffInvoice: Row = {
      payment_method: 'bank_transfer',
      payment_status: 'pending',
      recorded_by_user_id: 'staff-user-1',
    };

    it('shows an unpaid staff invoice whose payment method is bank transfer', () => {
      expect(isVisible(staffInvoice)).toBe(true);
    });

    it('still hides an abandoned customer checkout with the same payment details', () => {
      expect(isVisible({ ...staffInvoice, recorded_by_user_id: null })).toBe(
        false
      );
    });

    it('still shows paid customer orders and unpaid ones with no payment method', () => {
      expect(
        isVisible({
          payment_method: 'paystack',
          payment_status: 'paid',
          recorded_by_user_id: null,
        })
      ).toBe(true);
      expect(
        isVisible({
          payment_method: null,
          payment_status: 'pending',
          recorded_by_user_id: null,
        })
      ).toBe(true);
    });
  });
});
