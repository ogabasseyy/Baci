import { canUseSelectedShippingProvider } from './order-shipment';

interface CheckoutGiglPaidFeeOrder {
  payment_method?: string | null;
  payment_status?: string | null;
  selected_quote_id?: string | null;
  shipment_id?: string | null;
  shipping_fee?: number | null;
  shipping_funding_source?: string | null;
  shipping_provider?: string | null;
  tracking_number?: string | null;
}

// Mirrors the web booking prepaid check: fail-safe allow-list of payment
// methods verified to route the shipping fee to Baci. Any other method
// (credit_direct, oxygen, bank_transfer, pod, unknown providers) books from
// the merchant wallet, so it is never shown as paid by the customer.
const PAYMENT_METHODS_WITH_RETAINED_SHIPPING = new Set([
  'card',
  'paystack',
  'korapay',
  'uba_redvault',
  'invoice',
  'payforme',
  'juicyway',
  'klump',
  'wallet',
  'savings',
  'store_credit',
]);

/**
 * The GIG delivery price a customer paid at checkout, for display only. The
 * shipping funding source is stamped when the order is created, before
 * payment, so the order must also be paid with a method that keeps the
 * shipping money. Booking still re-checks the quote on the server.
 */
export function getCheckoutGiglPaidShippingFee(
  order: CheckoutGiglPaidFeeOrder | null | undefined
): number | null {
  if (!order) return null;
  if (order.shipping_provider?.trim().toUpperCase() !== 'GIGL') return null;
  if (order.shipping_funding_source !== 'customer_checkout') return null;
  if (order.payment_status !== 'paid') return null;
  const method = (order.payment_method ?? '').trim().toLowerCase();
  if (!PAYMENT_METHODS_WITH_RETAINED_SHIPPING.has(method)) return null;
  if (!canUseSelectedShippingProvider(order)) return null;
  const fee = Number(order.shipping_fee);
  return Number.isFinite(fee) && fee > 0 ? fee : null;
}
