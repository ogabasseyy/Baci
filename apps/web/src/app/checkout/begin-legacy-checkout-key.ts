// Checkout idempotency-key orchestration for the legacy page.
//
// Code-bearing checkouts must carry a persisted idempotency key: the
// loyalty wrapper only replays a committed create when the key is
// present, and the orders route rejects code checkouts without one.
// Beginning a session resolves the fingerprint-scoped persisted key
// (throwing when browser storage is unavailable, so the caller fails
// the submit closed rather than risk a duplicate against a single-use
// code). Completing a session clears the key so a repeated identical
// cart with a reusable code creates a fresh order — except loyalty
// checkouts, whose key is retained through the payment handoff: the
// shopper may close the BNPL popup, have a gateway redirect blocked,
// or abandon the gateway and retry later, and only this key can
// replay the already-claimed order instead of minting a second key
// that the wrapper rejects as already used. The page retires the
// retained key when payment succeeds or the claimed order reports
// itself cancelled, so retention cannot strand a fresh purchase.
import type { buildCheckoutOrderItems } from '@/lib/checkout/build-order-items';
import type { LegacyCheckoutKeyInput } from './build-legacy-checkout-fingerprint';
import type { CheckoutShippingSelectionPayload } from './checkout-order-shipping-payload';
import { clearLegacyCheckoutIdempotencyKey } from './clear-legacy-checkout-idempotency-key';
import { resolveLegacyCheckoutIdempotencyKey } from './resolve-legacy-checkout-idempotency-key';

export interface BeginLegacyCheckoutKeyInput {
  merchantId: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  gateway: string;
  shippingFee: number;
  discountCode: string;
  discountCodeIsLoyalty: boolean;
  orderItems: ReturnType<typeof buildCheckoutOrderItems>;
  shippingAddress: LegacyCheckoutKeyInput['shippingAddress'];
  shippingSelection: CheckoutShippingSelectionPayload;
}

export interface LegacyCheckoutKeySession {
  idempotencyKey: string | null;
  keyInput: LegacyCheckoutKeyInput;
  completeCheckout: () => Promise<void>;
}

export async function beginLegacyCheckoutKey(
  input: BeginLegacyCheckoutKeyInput
): Promise<LegacyCheckoutKeySession> {
  const keyInput: LegacyCheckoutKeyInput = {
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
  };
  // Loyalty codes fail closed without storage (the route requires
  // the key and a lost response is unrecoverable without it). Reusable
  // merchant codes do not need a persisted key, so storage-restricted
  // browsers proceed keyless instead of being blocked entirely.
  let idempotencyKey: string | null;
  try {
    idempotencyKey = await resolveLegacyCheckoutIdempotencyKey(keyInput);
  } catch (error) {
    if (input.discountCodeIsLoyalty) throw error;
    idempotencyKey = null;
  }
  const retainForLoyaltyResume = input.discountCodeIsLoyalty;
  return {
    idempotencyKey,
    keyInput,
    completeCheckout: async () => {
      if (!retainForLoyaltyResume) {
        await clearLegacyCheckoutIdempotencyKey(keyInput);
      }
    },
  };
}
