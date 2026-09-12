// Canonical projection for a freshly paid order row, consumed by push
// notifications and the paid-order side-effects outbox. A1: tax_basis,
// gift_wrapping_fee, tax_amount and discount_amount feed the outbox helper's
// financialConsistency() check. The nested order_items list must NOT include
// `subtotal` — the column does not exist and PostgREST rejects the whole
// statement with 42703 (PR #2999 incident).
export const PAID_ORDER_RICH_SELECT =
  'id, merchant_id, order_number, customer_id, total, subtotal, shipping_fee, shipping_provider, shipping_funding_source, shipping_platform_retained_amount, gift_wrapping_fee, tax_amount, discount_amount, tax_basis, customer_name, customer_email, customer_phone, shipping_address, currency, payment_status, shipping_status, cancelled_at, updated_at, ad_tracking, order_items(id, product_id, condition, name, price, quantity, variant_name)';
