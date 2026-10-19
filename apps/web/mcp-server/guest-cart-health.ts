import type { GuestCartStore } from './guest-cart-store';

/** Minimal store surface the guest-cart tool needs. */
export interface GuestCartStoreLike {
  update: GuestCartStore['update'];
  hasToken: GuestCartStore['hasToken'];
  /** Token-free code of the latest failed store write, cleared by the next success. */
  lastStorageErrorCode?: string | null;
  /** False when no canonical bridge is configured/allowlisted (legacy only). */
  canonicalEnabled?: boolean;
}

/**
 * /health fragment for guest-cart storage: degraded (with the latest
 * failure code) once a write fails, ok again after the next success.
 * Callers keep the overall probe green either way — catalog tools stay up
 * by design — so ops get a signal without a restart loop.
 */
export function describeGuestCartStoreHealth(store: GuestCartStoreLike): {
  guestCarts: 'ok' | 'degraded';
  guestCartsReason?: string;
  guestCartsCanonical: 'enabled' | 'disabled';
} {
  // Canonical-disabled is operator-visible but not a degradation:
  // legacy guest carts keep working by design.
  const guestCartsCanonical =
    store.canonicalEnabled === false ? 'disabled' : 'enabled';
  if (store.lastStorageErrorCode != null)
    return {
      guestCarts: 'degraded',
      guestCartsReason: `guest cart write failed (${store.lastStorageErrorCode})`,
      guestCartsCanonical,
    };
  return { guestCarts: 'ok', guestCartsCanonical };
}
