import { TRANSACTION_REVIEW_EXCLUDED_SHIPPING_STATUSES } from './transaction-review-status';

const excludedShippingStatuses = new Set<string>(
  TRANSACTION_REVIEW_EXCLUDED_SHIPPING_STATUSES
);

export function filterExcludedTransactionReviewRows<
  T extends {
    cancelled_at?: string | null;
    shipping_status?: string | null;
  },
>(rows: T[]) {
  return rows.filter(
    (row) =>
      row.cancelled_at == null &&
      !excludedShippingStatuses.has(row.shipping_status ?? '')
  );
}
