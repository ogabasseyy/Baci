import { beforeEach, expect, it, vi } from 'vitest';
import {
  beginDeferredCartLogout,
  DEFERRED_LOGOUT_LEASE_MS,
  endDeferredCartLogout,
  isDeferredCartLogout,
  reconcileOrphanedDeferredCartLogout,
} from './cart-deferred-logout';

const KEY = 'baci-cart-logout-deferred:shop';

beforeEach(() => {
  window.localStorage.clear();
  endDeferredCartLogout('shop');
  vi.restoreAllMocks();
});

it('tracks a live deferred logout in memory and storage', () => {
  beginDeferredCartLogout('shop');
  expect(isDeferredCartLogout('shop')).toBe(true);
  expect(window.localStorage.getItem(KEY)).not.toBeNull();
  endDeferredCartLogout('shop');
  expect(isDeferredCartLogout('shop')).toBe(false);
  expect(window.localStorage.getItem(KEY)).toBeNull();
});

it('expires a persisted marker past its lease so orphans cannot fence forever', () => {
  window.localStorage.setItem(
    KEY,
    String(Date.now() - DEFERRED_LOGOUT_LEASE_MS - 1)
  );
  expect(isDeferredCartLogout('shop')).toBe(false);
  expect(window.localStorage.getItem(KEY)).toBeNull();
});

it('reconciles legacy and expired orphans but keeps live leases', () => {
  window.localStorage.setItem(KEY, '1');
  expect(reconcileOrphanedDeferredCartLogout('shop')).toBe(true);
  expect(window.localStorage.getItem(KEY)).toBeNull();

  window.localStorage.setItem(KEY, String(Date.now()));
  expect(reconcileOrphanedDeferredCartLogout('shop')).toBe(false);
  expect(isDeferredCartLogout('shop')).toBe(true);
});
