import { beforeEach, expect, it, vi } from 'vitest';
import { eraseRetiredCartCache } from '@/hooks/cart/retired-cart-cache';
import { revokeCartDeviceSession } from '@/hooks/cart/shared-cart-session-revoke-client';
import { clearCartStorage } from '@/hooks/use-cart';
import { retirePreviousAccountCartAuthority } from './customer-auth-retirement';
import { getRememberedCustomerUserId } from './customer-auth-storage';

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
  clearCartDeviceRevocationPending: vi.fn(),
  markCartDeviceRevocationPending: vi.fn(),
  revokeCartDeviceSession: vi.fn(),
}));
vi.mock('@/hooks/cart/shared-cart-storage', () => ({
  bumpCartSessionGeneration: vi.fn(),
}));
vi.mock('@/hooks/use-cart', () => ({ clearCartStorage: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

it('retains the retiring identity when cache erasure fails', async () => {
  vi.mocked(revokeCartDeviceSession).mockResolvedValue({ ok: true });
  vi.mocked(eraseRetiredCartCache).mockReturnValue(false);
  await expect(
    retirePreviousAccountCartAuthority('shop', 'old-user')
  ).resolves.toBe(false);
  expect(getRememberedCustomerUserId('shop')).toBe('old-user');
  // A failed erasure must preserve the saved cart for the rollback.
  expect(clearCartStorage).not.toHaveBeenCalled();
});

it('completes retirement when revocation and erasure succeed', async () => {
  vi.mocked(revokeCartDeviceSession).mockResolvedValue({ ok: true });
  vi.mocked(eraseRetiredCartCache).mockReturnValue(true);
  await expect(
    retirePreviousAccountCartAuthority('shop', 'old-user')
  ).resolves.toBe(true);
  expect(clearCartStorage).toHaveBeenCalledWith('shop', 'old-user');
  expect(getRememberedCustomerUserId('shop')).toBeNull();
});
