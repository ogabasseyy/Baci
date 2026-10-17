import { DEFAULT_ASSURANCE_RATE } from '@/lib/checkout/constants';
import type { OrderCreateInput } from '@/schemas/orders';

function calculateAssuranceFee(itemPrice: number, quantity: number) {
  return Math.round(itemPrice * quantity * DEFAULT_ASSURANCE_RATE * 100) / 100;
}

/**
 * Maps validated agentic order items to RPC item arguments: per-item
 * assurance fees and shared-cart line provenance. Kept separate from
 * the dispatcher so the argument contract is auditable independently
 * of webhook and cancellation helpers.
 */
export function buildAgenticOrderItems(body: OrderCreateInput) {
  return body.items.map((item) => {
    const itemPrice = item.negotiatedPrice ?? item.price;
    const hasAssurance = item.has_assurance || false;

    return {
      assurance_fee: hasAssurance
        ? calculateAssuranceFee(itemPrice, item.quantity)
        : 0,
      // Shared-cart line provenance for bound orders (traceability;
      // the binding RPC revalidates the cart version itself).
      ...(item.cart_line_id ? { cart_line_id: item.cart_line_id } : {}),
      condition: item.condition,
      has_assurance: hasAssurance,
      image_url: item.imageUrl ?? item.image_url ?? null,
      product_id: item.product_id || item.productId || item.id,
      // The binding guard prices bound submits against the reviewed
      // effective price (major units); never drop it from the mapping.
      price: itemPrice,
      quantity: item.quantity,
      variant_attributes:
        item.variantAttributes || item.variant_attributes || {},
      variant_id: item.variantId || item.variant_id,
    };
  });
}

export type AgenticOrderItems = ReturnType<typeof buildAgenticOrderItems>;

/**
 * Assembles the storefront-order RPC arguments, including the
 * dispatch-recomputed VAT amount and the forwarded parity-guard
 * fields.
 */
export function buildAgenticOrderRpcArgs(
  body: OrderCreateInput,
  orderItemsPayload: AgenticOrderItems,
  computedTaxAmount: number
) {
  return {
    p_ad_tracking: body.ad_tracking ?? null,
    p_customer_email: body.customer_email,
    p_customer_name: body.customer_name,
    p_customer_phone: body.customer_phone ?? null,
    p_discount_amount: body.discount_amount,
    p_items: orderItemsPayload,
    p_merchant_id: body.merchant_id,
    p_notes: body.notes ?? null,
    p_payment_method: body.payment_method,
    p_payment_status: body.payment_status,
    p_selected_quote_id: body.selected_quote_id || null,
    p_shipping_address: body.shipping_address || null,
    p_shipping_fee: body.shipping_fee,
    p_shipping_provider: body.shipping_provider ?? null,
    p_shipping_status: body.shipping_status,
    p_source: body.source,
    p_tax_amount: computedTaxAmount,
    // Forward `p_gift_wrapping_fee` through to the RPC: the schema
    // accepts the field, and omitting it left a silent under-quote
    // path. The RPC's `gift_wrapping_fee_negative` guard and the
    // column CHECK jointly clamp invalid input.
    p_gift_wrapping_fee: body.gift_wrapping_fee,
    // Forward `body.expected_total` to enable the RPC's
    // `order_total_mismatch` parity guard when the session
    // calculation emits a VAT-inclusive total; null skips the check.
    p_expected_total:
      typeof body.expected_total === 'number' ? body.expected_total : null,
    p_tracking_number: body.tracking_number ?? null,
    // Agentic checkout is API-key scoped, not tied to a customer auth session.
    p_user_id: null,
  };
}
