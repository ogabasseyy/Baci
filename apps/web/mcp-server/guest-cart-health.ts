import type { GuestCartStore } from './guest-cart-store';

/** Minimal store surface the guest-cart tool needs. */
export interface GuestCartStoreLike {
  update: GuestCartStore['update'];
  hasToken: GuestCartStore['hasToken'];
  /** Token-free code of the latest failed store write, cleared by the next success. */
  lastStorageErrorCode?: string | null;
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
} {
  if (store.lastStorageErrorCode != null)
    return {
      guestCarts: 'degraded',
      guestCartsReason: `guest cart write failed (${store.lastStorageErrorCode})`,
    };
  return { guestCarts: 'ok' };
}
