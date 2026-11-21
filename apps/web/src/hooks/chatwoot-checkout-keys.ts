function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

/**
 * Deterministic from the widget request id and the merchant only. A cart id is
 * deliberately not part of it: completing an order moves the cart on, and a
 * retry of the same widget request must still map to the same key. The widget
 * mints a fresh request id per attempt; the server rejects a reused key with a
 * different payload (CHECKOUT_IDEMPOTENCY_CONFLICT). Both outputs fit the
 * 16-128 byte key bound of /api/orders.
 */
export async function deriveChatwootCheckoutKeys(
  requestId: string,
  merchantId: string
): Promise<{ idempotencyKey: string; operationId: string } | null> {
  try {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`chatwoot-checkout:${merchantId}:${requestId}`)
    );
    const hex = toHex(digest);
    return { idempotencyKey: `cw-chk-${hex}`, operationId: `cw-op-${hex}` };
  } catch {
    return null;
  }
}
