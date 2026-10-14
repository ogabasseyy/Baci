/**
 * Live customer identity, published synchronously at every auth
 * mutation (Codex R95 P1). Context state reaches consumers only
 * after React re-renders, so a logout/switch landing after a
 * checkout POST was dispatched but before the promise settles is
 * invisible to render-derived refs — the stale result would publish
 * into the replacement session. Settlement checks read this
 * instead. Browser-only (singleton client provider); server
 * rendering never publishes or reads it.
 *
 * Focused module so the holder does not grow the already-oversized
 * auth context: the context publishes, settlement readers consume.
 */
let liveCustomerIdentity: {
  customerId: string | null;
  userId: string | null;
} = { customerId: null, userId: null };

/**
 * Publishes the current identity. The auth context calls this
 * alongside EVERY user/customer state mutation (session load, OTP
 * verify, logout, merchant-switch reset) — a missed site leaves
 * settlement checks comparing against a stale account. Tests use it
 * to simulate switches with or without a rerender.
 */
export function publishCustomerIdentity(
  user: { id: string } | null,
  customer: { id: string } | null
): void {
  liveCustomerIdentity = {
    customerId: customer?.id ?? null,
    userId: user?.id ?? null,
  };
}

/**
 * Settlement-time identity: synchronously current, unlike context
 * props or render-assigned refs. Compare its
 * `userId ?? customerId` against the submit-time capture; a mismatch
 * means the account switched (or signed out) mid-flight and the
 * result must be discarded.
 */
export function getLiveCustomerIdentity(): {
  customerId: string | null;
  userId: string | null;
} {
  return liveCustomerIdentity;
}
