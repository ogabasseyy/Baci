import type { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import type { CheckoutShippingSelectionPayload } from './checkout-order-shipping-payload';

export interface LegacyCheckoutKeyInput {
  merchantId: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  gateway: string;
  shippingFee: number;
  discountCode: string;
  orderItems: ReturnType<typeof buildCheckoutOrderItems>;
  shippingAddress: {
    firstName: string;
    lastName: string;
    address: string;
    city: string;
    state: string;
  };
  shippingSelection: CheckoutShippingSelectionPayload;
}

/**
 * Stable identity for a legacy checkout attempt. Every field that
 * participates in the server's checkout request hash belongs here:
 * omitting one (buyer name, shipping address) would reuse the prior
 * key for a corrected payload and surface as a spurious
 * checkout_idempotency_conflict instead of a fresh order.
 */
export function buildLegacyCheckoutFingerprint(
  input: LegacyCheckoutKeyInput
): string {
  return JSON.stringify({
    merchantId: input.merchantId,
    customerEmail: input.customerEmail,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    gateway: input.gateway,
    shippingFee: input.shippingFee,
    discountCode: input.discountCode,
    orderItems: input.orderItems,
    shippingAddress: input.shippingAddress,
    shippingSelection: input.shippingSelection,
  });
}
