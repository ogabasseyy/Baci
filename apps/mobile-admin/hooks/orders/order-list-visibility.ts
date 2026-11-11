type OrderListVisibilityQuery<TQuery> = {
  not: (column: string, operator: string, value: string) => TQuery;
  or: (filters: string) => TQuery;
};

export const HIDDEN_CHECKOUT_PAYMENT_STATUS_VALUES = [
  'bnpl_pending',
  'failed',
  'expired',
] as const;

const ONLINE_CHECKOUT_PAYMENT_METHOD_VALUES = [
  'paystack',
  'korapay',
  'bank_transfer',
  'credit_direct',
  'credpal',
  'klump',
  'juicyway',
] as const;

export const HIDDEN_CHECKOUT_PAYMENT_STATUSES = `(${HIDDEN_CHECKOUT_PAYMENT_STATUS_VALUES.join(',')})`;
export const ONLINE_CHECKOUT_PAYMENT_METHODS = `(${ONLINE_CHECKOUT_PAYMENT_METHOD_VALUES.join(',')})`;

// Orders staff create (in-store invoices, WhatsApp/Instagram sales) record
// the staff member. They are never abandoned checkouts, so an unpaid one
// must stay in the list even when its payment method is an online one.
// A NULL recorded_by_user_id means a customer checkout (storefront or
// customer app), which is what the abandoned-checkout rules target.
export const STAFF_CREATED_ORDER_FILTER = 'recorded_by_user_id.not.is.null';
export const CUSTOMER_CHECKOUT_ORDER_FILTER = 'recorded_by_user_id.is.null';

export const VISIBLE_PENDING_ORDER_FILTER = [
  'payment_status.not.in.(pending,unpaid)',
  'payment_method.is.null',
  `payment_method.not.in.${ONLINE_CHECKOUT_PAYMENT_METHODS}`,
  STAFF_CREATED_ORDER_FILTER,
].join(',');

export function applyOrderListVisibilityFilter<
  TQuery extends OrderListVisibilityQuery<TQuery>,
>(query: TQuery): TQuery {
  return query
    .not('payment_status', 'in', HIDDEN_CHECKOUT_PAYMENT_STATUSES)
    .or(VISIBLE_PENDING_ORDER_FILTER);
}
