import { afterEach, expect, it, vi } from 'vitest';
import {
  isCartSessionRetiring,
  runCartSessionWrite,
} from '@/hooks/cart/cart-session-write-fence';
import { revokeCartDeviceSession } from '@/hooks/cart/shared-cart-session-revoke-client';
import { getCartSessionGeneration } from '@/hooks/cart/shared-cart-storage';
import { clearCartStorage } from '@/hooks/use-cart';
import {
  commitCustomerAuthSession,
  performCustomerLogout,
} from './customer-auth-session';

vi.mock('@/hooks/cart/shared-cart-session-revoke-client', () => ({
  beginDeferredCartLogout: vi.fn(),
  cancelDeferredCartLogout: vi.fn(),
  endDeferredCartLogout: vi.fn(),
  clearCartDeviceRevocationPending: vi.fn(),
  clearCartDeviceSessionActive: vi.fn(),
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

it('does not clear the local session when the server logout fails', async () => {
  vi.mocked(clearCartStorage).mockClear();
  vi.mocked(revokeCartDeviceSession).mockResolvedValue({ ok: true });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('logout failed', { status: 500 }))
  );
  const setUser = vi.fn();
  const setCustomer = vi.fn();
  await expect(
    performCustomerLogout('ogabassey', setUser, setCustomer, vi.fn(), 'user-1')
  ).rejects.toThrow('Could not safely sign out');
  expect(clearCartStorage).not.toHaveBeenCalled();
  expect(setUser).not.toHaveBeenCalled();
  expect(setCustomer).not.toHaveBeenCalled();
  expect(isCartSessionRetiring('ogabassey')).toBe(false);
});

it('bounds the auth logout fetch so it cannot hold the cart lock indefinitely', async () => {
  vi.mocked(clearCartStorage).mockClear();
  vi.mocked(revokeCartDeviceSession).mockResolvedValue({ ok: true });
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  await performCustomerLogout('ogabassey', vi.fn(), vi.fn(), vi.fn(), 'user-1');
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/storefront/auth/logout',
    expect.objectContaining({
      method: 'POST',
      signal: expect.any(AbortSignal),
    })
  );
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

it('preserves the previous account cache when switching retirement fails', async () => {
  vi.mocked(clearCartStorage).mockClear();
  vi.mocked(revokeCartDeviceSession).mockResolvedValue({ ok: false });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ success: true }))
  );
  const setUser = vi.fn();
  const result = await commitCustomerAuthSession(
    'switch-shop',
    {
      user: { id: 'next-user', email: 'next@example.com', role: 'customer' },
      customer: {
        id: 'next-customer',
        email: 'next@example.com',
        first_name: 'Next',
        last_name: 'Buyer',
      },
    },
    {
      currentUserId: 'previous-user',
      setUser,
      setCustomer: vi.fn(),
      setOtpState: vi.fn(),
    }
  );
  expect(result).toBe(false);
  expect(clearCartStorage).not.toHaveBeenCalled();
  expect(setUser).not.toHaveBeenCalledWith(
    expect.objectContaining({ id: 'next-user' })
  );
  expect(isCartSessionRetiring('switch-shop')).toBe(false);
});
