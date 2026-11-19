/**
 * Shared TTL constants (seconds) for the merchant-scoped tri-state cart hint
 * cookie (`'1'` when active, `'0'` when known empty) across client and server.
 */
export const CART_SESSION_HINT_TTL_SECONDS = {
  active: 60 * 60 * 24 * 30,
  empty: 60 * 60,
} as const;
