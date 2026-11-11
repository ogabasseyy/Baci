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

// Customer checkouts (storefront, customer app, AI-agent checkout) never
// record a staff creator. Everything else (in-store invoices, WhatsApp,
// Instagram and other staff-entered or imported orders) is never an
// abandoned checkout, so it always stays in the orders list whatever its
// payment status. Source is checked as well as the creator because the
// creator is NULL on older staff orders and is cleared if the staff account
// is deleted.
const CUSTOMER_CHECKOUT_SOURCE_VALUES = [
  'online_store',
  'mobile_app',
  'storefront',
  'agentic_ai',
] as const;

const CUSTOMER_CHECKOUT_SOURCES = `(${CUSTOMER_CHECKOUT_SOURCE_VALUES.join(',')})`;

/** Conditions for use inside and(): the order is a customer checkout. */
export const CUSTOMER_CHECKOUT_ORDER_FILTER = [
  'recorded_by_user_id.is.null',
  `source.in.${CUSTOMER_CHECKOUT_SOURCES}`,
].join(',');

/** Conditions for use inside or(): the order was entered by staff. */
export const STAFF_CREATED_ORDER_FILTER = [
  'recorded_by_user_id.not.is.null',
  'source.is.null',
  `source.not.in.${CUSTOMER_CHECKOUT_SOURCES}`,
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
