import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CookieLockHarness } from './cart-cross-tab-lock.test-support';

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
const originalSecure = Object.getOwnPropertyDescriptor(
  window,
  'isSecureContext'
);
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: new CookieLockHarness(),
  });
});
afterEach(() => {
  vi.useRealTimers();
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
  if (originalSecure)
    Object.defineProperty(window, 'isSecureContext', originalSecure);
  else Reflect.deleteProperty(window, 'isSecureContext');
});
it.each([
  'getItem',
  'setItem',
] as const)('fails promptly without leaking locks when epoch %s is denied', async (method) => {
  const { revokeCartDeviceSession, resetPendingCartDeviceRevocationsForTests } =
    await import('./shared-cart-session-revoke-client');
  const { runBoundedCartSessionWrite, isCartSessionRetiring } = await import(
    './cart-session-write-fence'
  );
  const { fetchSharedCartSnapshot } = await import('./shared-cart-client');
  const { performCustomerLogout } = await import(
    '@/contexts/customer-auth-session'
  );
  const { fetchWithCsrf } = await import('@/lib/api-client');
  const denied = vi.spyOn(Storage.prototype, method).mockImplementation(() => {
    throw new DOMException('Storage denied', 'SecurityError');
  });
  const operation = vi.fn().mockResolvedValue(true);
  try {
    await expect(revokeCartDeviceSession('shop')).resolves.toEqual({
      ok: false,
    });
    await expect(
      performCustomerLogout('shop', vi.fn(), vi.fn(), vi.fn(), 'customer')
    ).rejects.toThrow('Could not safely sign out');
    await expect(
      fetchSharedCartSnapshot(undefined, 'shop')
    ).resolves.toMatchObject({ ok: false, code: 'temporarily_unavailable' });
    expect(operation).not.toHaveBeenCalled();
    expect(fetchWithCsrf).not.toHaveBeenCalled();
    expect(isCartSessionRetiring('shop')).toBe(false);
  } finally {
    denied.mockRestore();
    resetPendingCartDeviceRevocationsForTests();
  }
  await expect(
    runBoundedCartSessionWrite('shop', false, operation)
  ).resolves.toBe(true);
});
