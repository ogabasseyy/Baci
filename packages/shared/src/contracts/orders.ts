export const WEB_ORDER_COLUMNS =
  'id, created_at, updated_at, merchant_id, branch_id, customer_id, order_number, customer_name, customer_email, customer_phone, shipping_status, payment_status, total, subtotal, shipping_fee, gift_wrapping_fee, tax_amount, tax_basis, discount_amount, shipping_address, delivery_method, airport_type, source, notes, payment_method, ad_tracking, currency, exchange_rate, original_currency, original_total, selected_quote_id, shipping_provider, tracking_number, tracking_token, amount_paid, wallet_amount_used, fulfillment_details';

export const WEB_ORDER_COLUMNS_PUBLIC =
  'id, created_at, updated_at, merchant_id, branch_id, customer_id, order_number, customer_name, customer_email, customer_phone, shipping_status, payment_status, total, subtotal, shipping_fee, gift_wrapping_fee, tax_amount, tax_basis, discount_amount, shipping_address, source, notes, payment_method, ad_tracking, currency, exchange_rate, original_currency, original_total, selected_quote_id, shipping_provider, tracking_number, tracking_token, amount_paid, wallet_amount_used';

export const WEB_ORDER_ITEMS_COLUMNS =
  'id, created_at, order_id, product_id, condition, image_url, variant_name, name, price, quantity, fulfillment_data, has_assurance, assurance_fee';

export const WEB_ORDER_ITEMS_COLUMNS_PUBLIC =
  'id, created_at, order_id, product_id, condition, image_url, variant_name, name, price, quantity, has_assurance, assurance_fee';

export const WEB_ORDER_WITH_ITEMS_QUERY = `${WEB_ORDER_COLUMNS}, order_items(${WEB_ORDER_ITEMS_COLUMNS})`;

export const WEB_ORDER_WITH_ITEMS_QUERY_PUBLIC = `${WEB_ORDER_COLUMNS_PUBLIC}, order_items(${WEB_ORDER_ITEMS_COLUMNS_PUBLIC})`;

export const MOBILE_ADMIN_ORDER_COLUMNS =
  'id, order_number, merchant_id, branch_id, customer_id, customer_name, customer_email, customer_phone, shipping_status, payment_status, total, subtotal, shipping_fee, gift_wrapping_fee, tax_amount, tax_basis, tax_exclusive_amount, tax_inclusive_amount, discount_amount, amount_paid, currency, source, payment_method, notes, is_credit_order, shipping_address, delivery_method, airport_type, recorded_by_user_id, wallet_amount_used, selected_quote_id, shipping_provider, shipping_funding_source, tracking_number, tracking_token, shipment_id, fulfillment_type, fulfillment_details, self_fulfillment_data, created_at, updated_at';

export const MOBILE_ADMIN_ORDER_ITEMS_COLUMNS =
  'id, product_id, condition, has_assurance, image_url, item_description, details:item_description, product_match_status, variant_id, variant_name, variant_attributes, name, product_name:name, quantity, price';

export const MOBILE_ADMIN_ORDER_WITH_ITEMS_QUERY = `${MOBILE_ADMIN_ORDER_COLUMNS}, items:order_items(${MOBILE_ADMIN_ORDER_ITEMS_COLUMNS})`;

export type OrderEditChangeCategory =
  | 'customer_visible'
  | 'financial'
  | 'internal';

export const CUSTOMER_NOTIFICATION_ORDER_EDIT_CATEGORIES: readonly OrderEditChangeCategory[] =
  ['customer_visible', 'financial'];

export interface OrderEditNotificationDecision {
  change_category?: OrderEditChangeCategory | null;
  notify_customer?: boolean | null;
}

export interface OrderAuditEventContract {
  change_category: OrderEditChangeCategory;
  changed_fields: string[];
}

export function normalizeOrderEditChangeCategory(
  value: unknown
): OrderEditChangeCategory | null {
  if (
    value === 'customer_visible' ||
    value === 'financial' ||
    value === 'internal'
  ) {
    return value;
  }

  return null;
}

export function shouldNotifyCustomerForOrderEdit(
  result: OrderEditNotificationDecision
): boolean {
  return Boolean(
    result.notify_customer &&
      result.change_category &&
      CUSTOMER_NOTIFICATION_ORDER_EDIT_CATEGORIES.includes(
        result.change_category
      )
  );
}

type ShippingAddressLike = {
  address?: unknown;
  address_line1?: unknown;
};

function isShippingAddressLike(value: unknown): value is ShippingAddressLike {
  return typeof value === 'object' && value !== null;
}

export function extractOrderDeliveryAddress(
  shippingAddress: unknown
): string | null {
  if (typeof shippingAddress === 'string') {
    const trimmed = shippingAddress.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (!isShippingAddressLike(shippingAddress)) {
    return null;
  }

  const address =
    typeof shippingAddress.address === 'string'
      ? shippingAddress.address.trim()
      : '';
  const fallbackAddress =
    typeof shippingAddress.address_line1 === 'string'
      ? shippingAddress.address_line1.trim()
      : '';
  const resolvedAddress = address || fallbackAddress;

  return resolvedAddress.length > 0 ? resolvedAddress : null;
}
