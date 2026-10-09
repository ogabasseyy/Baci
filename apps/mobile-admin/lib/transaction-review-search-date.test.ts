import { describe, expect, it } from 'vitest';
import {
  filterTransactionOrders,
  mapTransactionOrderRows,
} from './transaction-review';
import type { TransactionReviewOrderRow } from './transaction-review-types';

function buildRow(overrides: Partial<TransactionReviewOrderRow>) {
  return {
    created_at: '2026-10-05T00:00:00+00:00',
    customer_email: null,
    customer_name: null,
    customer_phone: null,
    fulfillment_details: null,
    id: 'order-1',
    order_items: [],
    order_number: null,
    payment_method: null,
    total: null,
    ...overrides,
  };
}

describe('transaction review search-date parity', () => {
  it('indexes the canonical UTC form matching the search RPC', () => {
    const [order] = mapTransactionOrderRows([
      buildRow({ transaction_date: '2026-10-05T00:00:00+00:00' }),
    ]);

    // Lowercased by buildSearchText; the RPC matches case-insensitively.
    expect(order.searchText).toContain('2026-10-05t00:00:00.000z');
    expect(order.searchText).not.toContain('+00:00');
    // Displayed value keeps the raw encoding.
    expect(order.createdAt).toBe('2026-10-05T00:00:00+00:00');
  });

  it('matches a full canonical timestamp term client-side', () => {
    const orders = mapTransactionOrderRows([
      buildRow({ transaction_date: '2026-10-05T00:00:00+00:00' }),
    ]);

    expect(
      filterTransactionOrders(orders, '2026-10-05T00:00:00.000Z')
    ).toHaveLength(1);
  });

  it('falls back to the raw value when the date is unparseable', () => {
    const [order] = mapTransactionOrderRows([
      buildRow({
        created_at: 'not-a-date',
        transaction_date: null,
      }),
    ]);

    expect(order.searchText).toContain('not-a-date');
  });
});
