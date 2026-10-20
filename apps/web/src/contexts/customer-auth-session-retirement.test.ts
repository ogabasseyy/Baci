import { afterEach, expect, it, vi } from 'vitest';
import {
  isCartSessionRetiring,
  runCartSessionWrite,
} from '@/hooks/cart/cart-session-write-fence';
import { revokeCartDeviceSession } from '@/hooks/cart/shared-cart-session-revoke-client';
import { getCartSessionGeneration } from '@/hooks/cart/shared-cart-storage';
import { clearCartStorage } from '@/hooks/use-cart';
import { performCustomerLogout } from './customer-auth-session';

vi.mock('@/hooks/cart/shared-cart-session-revoke-client', () => ({
  markCartDeviceRevocationPending: vi.fn(),
  revokeCartDeviceSession: vi.fn(),
}));
vi.mock('@/hooks/use-cart', () => ({ clearCartStorage: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it('fences and drains authority writes before logout revocation', async () => {
  vi.mocked(revokeCartDeviceSession)
    .mockClear()
    .mockResolvedValue({ ok: true });
  vi.mocked(clearCartStorage).mockClear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  let finish!: () => void;
  const write = runCartSessionWrite(
    'ogabassey',
    false,
    () =>
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      })
  );
  const previousGeneration = getCartSessionGeneration();
  const logout = performCustomerLogout(
    'ogabassey',
    vi.fn(),
    vi.fn(),
    vi.fn(),
    'user-1'
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(isCartSessionRetiring('ogabassey')).toBe(true);
  expect(getCartSessionGeneration()).toBeGreaterThan(previousGeneration);
  expect(clearCartStorage).not.toHaveBeenCalled();
  expect(revokeCartDeviceSession).not.toHaveBeenCalled();
  finish();
  await write;
  await logout;
  expect(revokeCartDeviceSession).toHaveBeenCalledOnce();
  expect(clearCartStorage).toHaveBeenCalledWith('ogabassey', 'user-1');
  expect(isCartSessionRetiring('ogabassey')).toBe(false);
});

it('preserves saved device items when logout revocation fails', async () => {
  vi.mocked(clearCartStorage).mockClear();
  vi.mocked(revokeCartDeviceSession).mockResolvedValue({ ok: false });
  const setUser = vi.fn();
  await expect(
    performCustomerLogout('ogabassey', setUser, vi.fn(), vi.fn(), 'user-1')
  ).rejects.toThrow('Could not safely sign out');
  expect(clearCartStorage).not.toHaveBeenCalled();
  expect(setUser).not.toHaveBeenCalled();
  expect(isCartSessionRetiring('ogabassey')).toBe(false);
});
