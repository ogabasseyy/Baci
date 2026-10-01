import { sanitizePublicOrder } from '@/lib/public-fulfillment-sanitizer';

/**
 * Proof-bound `get_order_tracking` row projection used by the guest
 * order response. Non-nullable columns stay required; everything the
 * response defaults (`?? 0`, `?? null`, `?? false`) is unknown so
 * older RPC projections keep reading through the same defaults.
 */
export interface GuestTrackingOrderRow {
  id: string;
  order_number: string;
  currency: unknown;
  subtotal: unknown;
  tax_amount?: unknown;
  discount_amount?: unknown;
  gift_wrapping_fee?: unknown;
  shipping_cost?: unknown;
  shipping_fee?: unknown;
  total: unknown;
  amount_paid?: unknown;
  customer_name?: unknown;
  customer_email?: unknown;
  customer_phone?: unknown;
  shipping_address?: unknown;
  payment_status?: unknown;
  shipping_status?: unknown;
  payment_method?: unknown;
  external_source?: unknown;
  import_job_id?: unknown;
  merchant_id?: unknown;
  notification_delivered?: unknown;
}

export interface GuestOrderResponseInput {
  order: GuestTrackingOrderRow;
  token: string | null;
  items: unknown[];
  virtualAccount: unknown;
  inventoryConfirmed: boolean;
}

/**
 * Assembles the public guest order response from the tracking
 * projection: money fields default to zero, nullable references to
 * null, and proof/delivery bits to false on older RPC projections.
 * Extracted from the route (Boy Scout rule).
 */
export function buildGuestOrderResponse(input: GuestOrderResponseInput) {
  const { order, token, items, virtualAccount, inventoryConfirmed } = input;
  return sanitizePublicOrder({
    id: order.id,
    order_number: order.order_number,
    short_id: order.order_number,
    currency: order.currency,
    subtotal: order.subtotal,
    tax_amount: order.tax_amount ?? 0,
    discount_amount: order.discount_amount ?? 0,
    gift_wrapping_fee: order.gift_wrapping_fee ?? 0,
    shipping_cost: order.shipping_cost ?? order.shipping_fee ?? 0,
    total: order.total,
    amount_paid: order.amount_paid,
    customer_name: order.customer_name,
    customer_email: order.customer_email,
    customer_phone: order.customer_phone,
    shipping_address: order.shipping_address,
    payment_status: order.payment_status,
    shipping_status: order.shipping_status,
    payment_method: order.payment_method,
    external_source: order.external_source ?? null,
    import_job_id: order.import_job_id ?? null,
    merchant_id: order.merchant_id,
    tracking_token: token || null,
    items,
    virtual_account: virtualAccount,
    // Terminal after() delivery (invoice artifacts built and proforma
    // emailed): success screens gate invoice_generated on this instead
    // of claiming it at order creation. Absent on older RPC
    // projections, which read as not delivered.
    notification_delivered: order.notification_delivered ?? false,
    // Server-confirmed inventory: the status poll gates confirmation
    // on this instead of the approved status alone.
    inventory_confirmed: inventoryConfirmed,
  });
}
