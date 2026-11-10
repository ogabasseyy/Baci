import {
  oxygenCheckoutSnapshotSchema,
  oxygenPurchasedCartLineSchema,
} from '@/schemas/oxygen-checkout-snapshot';

const keyFor = (orderId: string) =>
  `oxygen-checkout-snapshot:${encodeURIComponent(orderId)}`;

type CheckoutLine = {
  cartItemId?: string;
  cartLineInstanceId?: string;
  quantity?: number;
  serverLineId?: string | null;
};
/** Capture only once, from the exact checkout cart used to create the order. */
export function captureOxygenCheckoutSnapshot(
  orderId: string,
  merchantId: string,
  cart: readonly CheckoutLine[]
) {
  try {
    const key = keyFor(orderId);
    if (sessionStorage.getItem(key)) return;
    if (cart.some((line) => line.serverLineId)) return;
    const lines = cart.flatMap((line) => {
      const parsed = oxygenPurchasedCartLineSchema.safeParse({
        cartItemId: line.cartItemId,
        instanceId: line.cartLineInstanceId,
        quantity: line.quantity,
      });
      return parsed.success ? [parsed.data] : [];
    });
    if (new Set(lines.map((line) => line.instanceId)).size !== lines.length)
      return;
    sessionStorage.setItem(
      key,
      JSON.stringify({
        orderId,
        merchantId,
        lines,
        checkoutForm: sessionStorage.getItem('checkout-form'),
      })
    );
  } catch {
    /* Older or unavailable local storage stays conservative. */
  }
}
export function readOxygenCheckoutSnapshot(
  orderId: string,
  merchantId: string
) {
  try {
    const raw = sessionStorage.getItem(keyFor(orderId));
    if (!raw) return null;
    const parsed = oxygenCheckoutSnapshotSchema.safeParse(JSON.parse(raw));
    if (
      !parsed.success ||
      parsed.data.orderId !== orderId ||
      parsed.data.merchantId !== merchantId
    )
      return null;
    if (
      new Set(parsed.data.lines.map((line) => line.instanceId)).size !==
      parsed.data.lines.length
    )
      return null;
    return parsed.data;
  } catch {
    return null;
  }
}
export function clearOxygenCheckoutSnapshot(orderId: string) {
  try {
    sessionStorage.removeItem(keyFor(orderId));
  } catch {
    /* Keep checkout usable. */
  }
}
