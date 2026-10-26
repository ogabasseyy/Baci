import { beforeEach, expect, it, vi } from 'vitest';
import { eraseRetiredCartCache } from '@/hooks/cart/retired-cart-cache';
import { clearCartStorage } from '@/hooks/use-cart';
import {
  performCustomerLogout,
  resetRememberedCustomerSessionsForTests,
} from './customer-auth-session';

vi.mock('@/hooks/cart/cart-session-write-fence', () => ({
  beginCartSessionRetirement: () => ({
    drained: Promise.resolve(),
    release: vi.fn(),
  }),
}));
vi.mock('@/hooks/cart/retired-cart-cache', () => ({
  eraseRetiredCartCache: vi.fn(),
}));
vi.mock('@/hooks/cart/shared-cart-session-revoke-client', () => ({
  beginDeferredCartLogout: vi.fn(),
  cancelDeferredCartLogout: vi.fn(),
  clearCartDeviceRevocationPending: vi.fn(),
  clearCartDeviceSessionActive: vi.fn(),
  endDeferredCartLogout: vi.fn(),
  markCartDeviceRevocationPending: vi.fn(),
  revokeCartDeviceSession: vi.fn().mockResolvedValue({ ok: true }),
  resetPendingCartDeviceRevocationsForTests: vi.fn(),
}));
vi.mock('@/hooks/cart/cart-deferred-logout', () => ({
  reconcileOrphanedDeferredCartLogout: vi.fn(),
}));
vi.mock('@/hooks/cart/shared-cart-storage', () => ({
  bumpCartSessionGeneration: vi.fn(),
}));
vi.mock('@/hooks/use-cart', () => ({ clearCartStorage: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  resetRememberedCustomerSessionsForTests();
  window.localStorage.clear();
});

it('preserves unscoped cart keys when retired-cache erasure fails on logout', async () => {
  vi.mocked(eraseRetiredCartCache).mockReturnValue(false);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
  );
  window.localStorage.setItem('baci-cart', 'saved');
  window.localStorage.setItem('baci-cart-guest', 'saved');
  await performCustomerLogout('shop', vi.fn(), vi.fn(), vi.fn(), 'old-user');
  // The committed logout still finishes, but the failed scoped
  // erasure must not trigger the unconditional unscoped clear.
  expect(clearCartStorage).not.toHaveBeenCalled();
  expect(window.localStorage.getItem('baci-cart')).toBe('saved');
  expect(window.localStorage.getItem('baci-cart-guest')).toBe('saved');
});
