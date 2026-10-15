// Persisted Idempotency-Key for the legacy checkout page.
//
// The loyalty order wrapper can only replay a committed create when
// the request carries a checkout idempotency key; without one, a
// response lost after commit leaves the shopper retrying into
// loyalty_code_already_used against an order that already exists (and
// dropping the code can then duplicate the order). The legacy page
// therefore resolves the same persisted, fingerprint-scoped key the
// storefront checkout uses whenever a discount code is applied: a
// retry of the same checkout replays the original order, while any
// change to the buyer, cart, shipping selection, or code mints a
// fresh key. The key is intentionally never cleared on success — the
// fingerprint scopes it, and the stored key expires after the shared
// 24h TTL.

import {
  clearCheckoutIdempotencyKey,
  getCheckoutIdempotencyKey,
} from '@/components/storefront/ogabassey/pages/checkout/checkout-idempotency';
import type { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import type { CheckoutShippingSelectionPayload } from './checkout-order-shipping-payload';

export interface LegacyCheckoutKeyInput {
  merchantId: string;
  customerEmail: string;
  customerPhone: string;
  gateway: string;
  shippingFee: number;
  discountCode: string;
  orderItems: ReturnType<typeof buildCheckoutOrderItems>;
  shippingSelection: CheckoutShippingSelectionPayload;
}

export function buildLegacyCheckoutFingerprint(
  input: LegacyCheckoutKeyInput
): string {
  return JSON.stringify({
    merchantId: input.merchantId,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    gateway: input.gateway,
    shippingFee: input.shippingFee,
    discountCode: input.discountCode,
    orderItems: input.orderItems,
    shippingSelection: input.shippingSelection,
  });
}

export function resolveLegacyCheckoutIdempotencyKey(
  input: LegacyCheckoutKeyInput
): Promise<string> {
  return getCheckoutIdempotencyKey(buildLegacyCheckoutFingerprint(input));
}

export function clearLegacyCheckoutIdempotencyKey(
  input: LegacyCheckoutKeyInput
): Promise<void> {
  return clearCheckoutIdempotencyKey(buildLegacyCheckoutFingerprint(input));
}
