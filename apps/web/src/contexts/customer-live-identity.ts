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
  merchantSlug: string | null;
  userId: string | null;
} = { customerId: null, merchantSlug: null, userId: null };

/**
 * Publishes the current identity. The auth context calls this
 * alongside EVERY user/customer state mutation (session load, OTP
 * verify, logout, merchant-switch reset) — a missed site leaves
 * settlement checks comparing against a stale account. The slug is
 * required (never defaulted): a storefront switch with the same
 * auth user must still discard the old store's in-flight result
 * (Codex R101 P2). Tests use it to simulate switches with or
 * without a rerender.
 */
export function publishCustomerIdentity(
  user: { id: string } | null,
  customer: { id: string } | null,
  merchantSlug: string | null
): void {
  liveCustomerIdentity = {
    customerId: customer?.id ?? null,
    merchantSlug,
    userId: user?.id ?? null,
  };
}

/**
 * Settlement-time identity: synchronously current, unlike context
 * props or render-assigned refs. Compare its
 * `userId ?? customerId` against the submit-time capture AND its
 * merchantSlug against the submit-time slug; a mismatch means the
 * account switched (or signed out) or the storefront changed
 * mid-flight and the result must be discarded.
 */
export function getLiveCustomerIdentity(): {
  customerId: string | null;
  merchantSlug: string | null;
  userId: string | null;
} {
  return liveCustomerIdentity;
}

/**
 * True when the live account or storefront no longer matches the
 * submitter (Codex R101 P2). Account compares user-first (a null
 * customer at capture flips on hydration, so customer-first would
 * false-positive); the merchant compares strictly — the same auth
 * user in a replacement storefront must not receive the old store's
 * result. A null live slug (no publish yet) skips the merchant leg:
 * pre-hydration submits are gated by readiness, not here.
 */
export function hasUtilityPurchaseIdentityMoved(submitter: {
  customerId: string | null;
  merchantSlug: string | null;
  userId: string | null;
}): boolean {
  const live = getLiveCustomerIdentity();
  const liveIdentity = live.userId ?? live.customerId ?? null;
  const submitterIdentity = submitter.userId ?? submitter.customerId ?? null;
  if (liveIdentity !== submitterIdentity) {
    return true;
  }
  return (
    live.merchantSlug != null && live.merchantSlug !== submitter.merchantSlug
  );
}
