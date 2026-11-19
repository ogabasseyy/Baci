import type { OrderDetailsRecord } from '@/components/orders/order-details.types';
import { getOrderDisplayTimeZone } from './get-order-display-time-zone';

export function formatOrderPlacedDate(
  order: Pick<OrderDetailsRecord, 'created_at' | 'transaction_date'>,
  merchantCountry?: string | null
): string {
  // Sale time and database creation time are different for historical entries.
  // Do not reuse invoice_issue_date: document dates can be edited independently.
  for (const value of [order.transaction_date, order.created_at]) {
    if (!value) continue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;

    return date.toLocaleString('en-NG', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: getOrderDisplayTimeZone(merchantCountry),
    });
  }

  return '-';
}
