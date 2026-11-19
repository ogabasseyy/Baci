/**
 * How long one warm instance may reuse a merchant's published mapping and
 * feature row. Unpublishing a store, removing `shared_cart`, or remapping a
 * slug or custom domain therefore reaches the hot cart routes within this
 * window, not instantly.
 */
export const CART_MERCHANT_LOOKUP_TTL_MS = 30_000;

/** Upper bound on remembered merchants and feature rows per instance. */
export const CART_MERCHANT_LOOKUP_MAX_ENTRIES = 500;
