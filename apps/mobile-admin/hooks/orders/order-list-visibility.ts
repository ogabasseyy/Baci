type OrderListVisibilityQuery<TQuery> = {
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

// Staff-entered orders (in-store invoices, social and marketplace sales,
// manual entries and imports) are never abandoned checkouts, so they always
// stay in the orders list whatever their payment status. An order counts as
// staff-entered when it records a staff creator or comes from a staff sales
// channel. The channel matters because the creator is NULL on older staff
// orders and is cleared if the staff account is deleted. Any other source,
// including a blank or unknown one, is treated as a customer checkout, which
// keeps the drop-off rules' long-standing behaviour for those orders.
// Keep in step with CHANNELS in components/orders/new-order.shared.ts.
export const STAFF_ORDER_SOURCE_VALUES = [
  'physical',
  'instagram',
  'whatsapp',
  'facebook',
  'tiktok',
  'jumia',
  'jiji',
  'konga',
  'twitter',
  'manual',
  'staff_entry',
  'bumpa',
] as const;

const STAFF_ORDER_SOURCES = `(${STAFF_ORDER_SOURCE_VALUES.join(',')})`;

/** Conditions for use inside and(): the order is a customer checkout. */
export const CUSTOMER_CHECKOUT_ORDER_FILTER = [
  'recorded_by_user_id.is.null',
  `or(source.is.null,source.not.in.${STAFF_ORDER_SOURCES})`,
].join(',');

/** Conditions for use inside or(): the order was entered by staff. */
export const STAFF_CREATED_ORDER_FILTER = [
  'recorded_by_user_id.not.is.null',
  `source.in.${STAFF_ORDER_SOURCES}`,
].join(',');

// Customer checkouts are shown unless they are a drop-off: an unpaid
// online-method checkout, or one that failed, expired or awaits BNPL.
export const VISIBLE_PENDING_ORDER_FILTER = [
  'payment_status.not.in.(pending,unpaid)',
  'payment_method.is.null',
  `payment_method.not.in.${ONLINE_CHECKOUT_PAYMENT_METHODS}`,
].join(',');

export const ORDER_LIST_VISIBILITY_FILTER = [
  STAFF_CREATED_ORDER_FILTER,
  `and(payment_status.not.in.${HIDDEN_CHECKOUT_PAYMENT_STATUSES},or(${VISIBLE_PENDING_ORDER_FILTER}))`,
].join(',');

export function applyOrderListVisibilityFilter<
  TQuery extends OrderListVisibilityQuery<TQuery>,
>(query: TQuery): TQuery {
  return query.or(ORDER_LIST_VISIBILITY_FILTER);
}
